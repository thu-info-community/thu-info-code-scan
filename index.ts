import * as fs from "fs";
import * as path from "path";
import * as process from "process";
import * as ts from "typescript";

const findSourceRoot = (): string => {
    const pkg = fs.readFileSync("package.json").toString();
    const name = JSON.parse(pkg).name;
    if (name === "thu-info-lib") {
        return path.join(process.cwd(), "src", "lib");
    } else {
        const modulePath = path.join(process.cwd(), "node_modules", "thu-info-lib");
        if (!fs.existsSync(modulePath)) {
            throw new Error("Cannot find `thu-info-lib` in `node_modules`");
        }
        return path.join(modulePath, "src", "lib");
    }
}

const root = findSourceRoot();

const files = fs.readdirSync(root);

interface SourceInfo {
    fileName: string;
    line: number;
    column: number;
}

const idMap: {[key: string]: string} = {
    "10000ea055dd8d81d09d5a1ba55d39ad": "清华大学信息门户2021",
    "051bb58cba58a1c5f67857606497387f": "清华家园网统一身份认证",
    "e02e7f2f6f841c9ff65383d17cf7a86a": "代码托管系统",
    "ef84f6d6784f6b834e5214f432d6173f": "图书馆座位预约系统",
    "5bf6e5a699d63ff1cdb082836ebd50f9": "清华大学教参服务平台",
};

const displayIdUsage = (id: string, {fileName, line, column}: SourceInfo) => {
    const md5Digest = id.split("/")[0]
    const idName = idMap[md5Digest];
    if (idName === undefined) {
        throw new Error(`Unrecognized md5 digest: ${md5Digest}`);
    }
    console.log(`通过统一认证接口访问 ${idName}`);
    console.log(`    访问网址 https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/${id}`);
    console.log(`    代码位置 ${path.join(root, fileName)}:${line}:${column}`);
    console.log();
}

const displayLoginUsage = ({fileName, line, column}: SourceInfo) => {
    console.log(`登录 清华大学WebVPN`);
    console.log("    访问网址 https://webvpn.tsinghua.edu.cn/login");
    console.log(`    代码位置 ${path.join(root, fileName)}:${line}:${column}`);
    console.log();
}

const nameMap: {[key: string]: {title: string; url: string}} = {
    loginLibraryRoomBooking: {
        title: "研读间/研讨间预约系统",
        url: "http://cab.hs.lib.tsinghua.edu.cn"
    },
};

const displayPasswordUsage = (name: string, {fileName, line, column}: SourceInfo) => {
    const usage = nameMap[name];
    if (usage === undefined) {
        throw new Error(`Unrecognized password usage: ${name}`);
    }
    console.log(`登录 ${usage.title}`);
    console.log(`    访问网址 ${usage.url}`);
    console.log(`    代码位置 ${path.join(root, fileName)}:${line}:${column}`);
    console.log();
}

const getSourceInfo = (node: ts.Node): SourceInfo => {
    const sourceFile = node.getSourceFile();
    const fileName = sourceFile.fileName;
    const sourceTextPartial = sourceFile.text.substring(0, node.pos);
    const line = sourceTextPartial.split("\n").length;
    const column = node.pos - sourceTextPartial.lastIndexOf("\n") + 1;
    return {fileName, line, column};
}

const scanId = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.CallExpression) {
        const callExpressionNode = node as ts.CallExpression;
        const fnName = callExpressionNode.expression.getText();
        if (fnName === "roamingWrapperWithMocks" || fnName === "roamingWrapper" || fnName === "roam") {
            const fnArguments = callExpressionNode.arguments;
            if (fnArguments[1].kind === ts.SyntaxKind.StringLiteral) {
                const policy = (fnArguments[1] as ts.StringLiteral).text;
                if (policy === "id") {
                    if (fnArguments[2].kind !== ts.SyntaxKind.StringLiteral) {
                        throw new Error(`Expected a string literal as the third argument of roamingWrapperWithMocks, got: ${fnArguments[2].getText()}`);
                    }
                    const id = (fnArguments[2] as ts.StringLiteral).text;
                    const sourceInfo = getSourceInfo(callExpressionNode);
                    displayIdUsage(id, sourceInfo);
                } else if (policy === "gitlab") {
                    const sourceInfo = getSourceInfo(callExpressionNode);
                    displayIdUsage("e02e7f2f6f841c9ff65383d17cf7a86a", sourceInfo);
                }
            }
        }
    }
    node.getChildren().forEach(scanId);
}

const scanLogin = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.CallExpression) {
        const callExpressionNode = node as ts.CallExpression;
        const fnName = callExpressionNode.expression.getText();
        if (fnName === "uFetch") {
            const fnArguments = callExpressionNode.arguments;
            if (fnArguments[0].getText() === "DO_LOGIN_URL") {
                const sourceInfo = getSourceInfo(callExpressionNode);
                displayLoginUsage(sourceInfo);
            }
        }
    }
    node.getChildren().forEach(scanLogin);
}

const scanPassword = (rootNode: ts.Node) => {
    const fileName = rootNode.getSourceFile().fileName
    if (fileName === "core.ts" || fileName === "cr.ts" || fileName === "water.ts" || fileName === "index.ts") {
        return;
    }
    rootNode.getChildAt(0).getChildren().forEach((c) => {
        switch (c.kind) {
            case ts.SyntaxKind.ImportDeclaration:
            case ts.SyntaxKind.ImportEqualsDeclaration:
            case ts.SyntaxKind.TypeAliasDeclaration:
            case ts.SyntaxKind.EnumDeclaration:
                break;
            case ts.SyntaxKind.VariableStatement:
                if (c.getText().includes("helper.password")) {
                    const declarationList = (c as ts.VariableStatement).declarationList as ts.VariableDeclarationList;
                    const variableDeclaration = (declarationList.getChildAt(1) as ts.SyntaxList).getChildAt(0) as ts.VariableDeclaration;
                    const name = variableDeclaration.name.getText();
                    const sourceInfo = getSourceInfo(declarationList);
                    displayPasswordUsage(name, sourceInfo);
                }
                break;
            default:
                throw new Error(`Unexpected top-level declaration statement at ${JSON.stringify(getSourceInfo(c))}`);
        }
    })
}

for (const fileName of files) {
    const sourceText = fs.readFileSync(path.join(root, fileName)).toString();
    const rootNode = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2018, true);
    scanId(rootNode);
    scanLogin(rootNode);
    scanPassword(rootNode);
}
