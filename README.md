# Repo Learning Orchestrator

帮助用户逐层看懂代码仓库的工具。

核心方法：**苏格拉底式引导**——不直接给答案，用问题让理解从推理中产生。

## 四层结构

| 层级 | 目标 | Agent |
|------|------|-------|
| Layer 1：地图层 | 建立全局方向感 | `agents/layer1_map` |
| Layer 2：主干层 | 跟着主流程走一遍 | `agents/layer2_trunk` |
| Layer 3：局部深入层 | 按主题理解关键设计 | `agents/layer3_deep` |
| Layer 4：复述与迁移层 | 把理解转化为能讲、能用 | `agents/layer4_recite` |

Layer 1 生成项目大纲作为起点。Layer 2-4 用苏格拉底式问答逐层深入，每层结束后用户可以自主选择是否继续。
