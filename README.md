# Cache Cleaner

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)

`Cache Cleaner` 是一款的 Windows 桌面硬盘清理工具。

## 测试环境

- Windows 10 / 11
- Node.js v25.5.0
- npm

## 启动

```bash
npm install
npm run start
```

## 打包

```bash
npm run package
```

打包产物输出到 `install-pack/` 目录(已加入 `.gitignore`)。

### 前置依赖(winget 安装)

打包的 Zip 与 NSIS 环节分别需要命令行工具 `zip`、`makensis`,用 winget 装:

```powershell
winget install GnuWin32.Zip
winget install NSIS.NSIS
```

装完环境变量 PATH 已添加`C:\Program Files (x86)\GnuWin32\bin` 和 `C:\Program Files (x86)\NSIS`。

### Qt 下载源

下载源路径位于配置文件: `node_modules/@nodegui/nodegui/config/qtConfig.js`，可自行更换。
