# whiteboard-notes

一个极简白板推导笔记应用（Vite + React + TypeScript + React Flow）。支持标签节点、连线推导、撤销重做、自动保存、PNG/JSON 导入导出。新增 Junction 合流：当某结论节点输入 >=2 时，自动生成合流点并规范化为 `inputs -> J -> C`。

## 启动

```bash
npm install
npm run dev
```

建议在系统终端运行 `npm run dev`（而不是在 Codex 会话里常驻运行），避免会话超时中断。

## 打包

```bash
npm run build
```

## 功能

- 白板拖拽、缩放、平移（React Flow）
- 节点 `title/body`，双击或右侧面板编辑
- 左右连线规则：默认右侧输出、左侧输入
- Junction 合流：同一结论 `>=2` 输入时自动转为 `A -> J, B -> J, J -> C`
- 公式提示：基于结论最终输入集合显示（`A + B => C`）
- 快捷键：
  - `N` 在当前视口中心创建节点
  - `L` 切换连线模式
  - `Delete` 删除选中节点/边
  - `Ctrl/Cmd + Z` 撤销
  - `Ctrl/Cmd + Y` 或 `Ctrl/Cmd + Shift + Z` 重做
  - `Ctrl/Cmd + D` 复制选中节点
- 本地自动保存（`localStorage`，key: `whiteboard-notes:v1`，300ms debounce）
- 导出 PNG（白底）
- 导出 JSON / 导入 JSON（导入后自动 normalize）
- 清空白板（二次确认）

## JSON 数据格式

导入导出内容为：

```json
{
  "nodes": [
    {
      "id": "node-id",
      "type": "note",
      "position": { "x": 0, "y": 0 },
      "data": { "title": "标题", "body": "内容" }
    }
  ],
  "edges": [
    {
      "id": "edge-id",
      "source": "node-a",
      "target": "node-b"
    }
  ]
}
```

## 容易踩坑

- 连线依赖 Handle：连线模式（L）关闭时 Handle 仍用于路径锚点，但不可连接。
- 拖拽节点时历史记录只在 `onNodeDragStop` 写入一次，避免拖动过程产生过多撤销步骤。
- Junction 位置在拖拽停止后更新，不在每一帧更新，避免卡顿。
- 公式文本为展示字段，持久化时不会保存 `formulaText`，导入后会自动重新计算。
- 导入可包含或不包含 junction；都会统一规范化。
- PNG 导出的是当前可见画布区域（包含当前缩放与视口）。

## 目录结构

```text
src/
  App.tsx
  canvas/
    Board.tsx
    nodeTypes/
      NoteNode.tsx
      JunctionNode.tsx
  state/
    store.ts
  utils/
    export.ts
  styles.css
  main.tsx
```
