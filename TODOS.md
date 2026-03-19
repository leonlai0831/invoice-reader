# TODOS

## Deferred Items

### 1. 后端 _atomic_write_json 重复消除
- **What:** config.py:34 和 main.py:71 都各自实现了 `_atomic_write_json`，逻辑完全一样。抽到共享的 utils.py 里。
- **Why:** 如果将来要改原子写入逻辑（比如加重试），要改两个地方，容易漏改出 bug。
- **Effort:** CC ~3分钟
- **Depends on:** 无

### 2. getRow() 底层改用 Map 查找
- **What:** Phase 1 重构后 `getRow(id)` 内部用 `rows.find()`（O(n)），将来可改成 Map 查找（O(1)）。
- **Why:** 当活跃行数增多时查找更快。目前活跃数据通常几十条，不是瓶颈。
- **Effort:** CC ~5分钟
- **Depends on:** Phase 1 完成（getRow 已抽取到 state.ts）

### 3. 亮色模式下 Chart.js 图表颜色适配
- **What:** 暗色模式的图表配色（Dashboard 4 个 chart）在亮色背景上对比度可能不足，需要为亮色模式单独适配颜色。
- **Why:** 暗色下的半透明颜色（如 `rgba(99,102,241,.4)`）在白色背景上会显得太淡，用户看不清数据。
- **Effort:** CC ~10分钟
- **Depends on:** 暗色/亮色模式切换功能完成后验证
