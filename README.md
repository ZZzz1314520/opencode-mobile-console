# OpenCode Share

在 Windows 11 主机上启动一个局域网 Web 控制台，让手机浏览器同步查看并可选控制当前目录下的 `oc` 会话。

## 功能

- 启动服务后自动在当前目录运行 `oc`。
- 手机通过 HTTP 访问，无需公网。
- 支持只读密码和控制密码。
- 只读模式只能同步查看输出。
- 控制模式可以向主机端 `oc` 输入内容。
- 移动端页面包含 Enter、Ctrl+C、Tab、Esc、方向键快捷按钮。
- 刷新或断线重连后恢复最近终端输出。

## 安装

```powershell
npm install
```

如果 `node-pty` 安装失败，通常需要安装 Visual Studio Build Tools 的 C++ 编译工具。

## 配置

复制配置文件：

```powershell
copy .env.example .env
```

编辑 `.env`：

```env
HOST=0.0.0.0
PORT=8787
VIEW_PASSWORD=readonly123
CONTROL_PASSWORD=control123
SHELL=powershell.exe
START_COMMAND=oc
TOKEN_SECRET=change-this-long-random-string
HISTORY_LIMIT=200000
```

建议修改 `VIEW_PASSWORD`、`CONTROL_PASSWORD` 和 `TOKEN_SECRET`。

## 开发启动

```powershell
npm run dev
```

开发模式下：

- 后端地址：`http://电脑IP:8787`
- Vite 前端地址：`http://电脑IP:5173`

推荐手机访问 Vite 地址 `5173`，它会代理 `/api` 和 `/ws` 到后端。

## 生产启动

```powershell
npm run build
npm start
```

手机访问：

```text
http://电脑局域网IP:8787
```

查看电脑局域网 IP：

```powershell
ipconfig
```

找到当前网卡的 IPv4 地址。

## Windows 防火墙

如果手机无法访问，检查 Windows 防火墙是否拦截 Node.js 或端口 `8787`。

可以在 Windows 安全中心允许 Node.js 通过专用网络，或手动开放端口 `8787`。

## 安全说明

控制模式等同于远程操作主机终端，不要暴露到公网，不要做路由器端口映射。

只读和控制权限由后端校验，前端隐藏输入框不是安全边界。
