---
name: api-state-consistency-check
description: 专项检查 API 契约与状态机映射是否一致，覆盖 allowed from/to、错误码、失败态重试与归档/恢复行为。用于 API 设计评审、状态机修订、前后端动作矩阵核对；检测到 api/state-machine/status-mapping 相关任务时应主动应用。
---

# API State Consistency Check

## 适用文件
- `docs/contracts/api.md`
- `docs/contracts/state-machine.md`
- `docs/contracts/status-mapping.md`

## 检查步骤
1. 对每个 API 动作列出允许 From/To。
2. 对照状态机转移表，检查是否存在“UI 可点但 API 不允许”。
3. 核对失败态：`FAILED_EXTRACTION` / `FAILED_AI` / `FAILED_EXPORT` 的 retry 入口是否一致。
4. 核对错误码与用户提示文案是否可对齐。

## 常见高危项
- export 重试与 `FAILED_EXPORT` 不一致。
- process/retry/regenerate 入口状态冲突。
- archive/unarchive 默认去向在文档间矛盾。
