# Docs — Accountant

这目录只保留当前仍有用的文档。

## 当前文档

| 文件 | 用途 |
|---|---|
| [`../README.md`](../README.md) | 项目入口、功能地图、开发命令 |
| [`../AI_HANDOFF.md`](../AI_HANDOFF.md) | Agent 接手时的当前事实和禁改点 |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 系统架构、模块边界、数据流、关键语义 |
| [`OPERATIONS.md`](./OPERATIONS.md) | 本地运行、环境变量、部署、故障排查 |
| [`ios-shortcut-guide.md`](./ios-shortcut-guide.md) | iOS 快捷指令截图/收据记账指南 |
| [`scriptable/README.md`](./scriptable/README.md) | iPhone Scriptable 最近交易 widget 指南 |

## 文档保留原则

- 当前事实优先；不要保留已完成/已废弃的执行计划当作真相。
- 设计方案如果已经实现，合并成架构或 handoff；未实现且不打算近期执行就删除。
- 代码路径、API 路径、环境变量必须能从当前仓库中找到。
- 涉及生产密钥、用户数据、token、cookies 的内容只写变量名和安全约束，不写真实值。
