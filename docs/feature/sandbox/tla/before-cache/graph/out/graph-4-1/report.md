# Graph

TLC reached 1,317 states, more than the chart budget of 500, so the chart draws only the bug paths: 11 states and 11 arrows.

## NoDeadlock breaks
The shortest path has 8 steps:
0. 两个配对查找前缀
1. 深分支命中，配对可开始: 深分支已就绪，冷分支继续准备
2. 冷分支未命中: 深分支已就绪，冷分支需要共同前缀
3. 请求准备上一层: 查找共同前缀
4. 共同前缀未命中: 共同前缀也未命中
5. 依赖已结算: 共同前缀可开始准备
6. 开始准备: 共同前缀占用准备额度
7. 发布共同前缀并留下准备实例: 共同前缀把准备实例留给无人准备的中间层
8. 冷分支等唯一的准备额度: 冷分支等额度，共同前缀等无人准备的中间层

## DispatchTerminates breaks
TLC's counterexample is in tlc-DispatchTerminates.out. It has 8 steps:
0. 两个配对查找前缀
1. 冷分支未命中: 冷分支需要共同前缀，深分支仍在查找
2. 深分支查找失败: 深分支已失败，冷分支需要共同前缀
3. 请求准备上一层: 查找共同前缀
4. 共同前缀未命中: 共同前缀也未命中
5. 依赖已结算: 共同前缀可开始准备
6. 开始准备: 共同前缀占用准备额度
7. 发布共同前缀并留下准备实例: 共同前缀把准备实例留给无人准备的中间层
8. 冷分支等唯一的准备额度: 冷分支等额度，共同前缀等无人准备的中间层
The run stops in "冷分支等额度，共同前缀等无人准备的中间层" forever.

## Rules that hold
GateBound
