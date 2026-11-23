# SpreadsheetBench 官方比较器快照

- 上游仓库：<https://github.com/RUCKBReasoning/SpreadsheetBench>
- 文件来源：[`evaluation/evaluation.py`](https://github.com/RUCKBReasoning/SpreadsheetBench/blob/e2758ac01c6c52efc746bf0d53b2fd01dbc42dd2/evaluation/evaluation.py)
- 固定上游 commit：`e2758ac01c6c52efc746bf0d53b2fd01dbc42dd2`
- 本地文件：[`evaluation/evaluation.py`](evaluation/evaluation.py)
- 本地 SHA-256：`772a743f71105aecfd5bd439d4dfe88a5ed4b82887d063eb2b1920c5216a41a8`
- 上游 README 声明许可：CC BY-SA 4.0；保留上游署名与链接。

本地单题包装器只调用上游的 `compare_workbooks()`，未修改比较函数。不要直接运行上游批量 `evaluation()`：该固定版本的批量入口把 `proc_path` 指向 `*_input.xlsx`，而输出路径仍被注释；单题包装器直接接收产品产物以绕过这个入口问题。比较器以 `data_only=True` 读取目标单元格，因此输入和产物是否有公式缓存/重算值会影响结果。

本地快照按固定 commit 的官方 Raw 文件行内容保存。使用前可从上游相同 commit 重新下载，并核对 SHA-256。
