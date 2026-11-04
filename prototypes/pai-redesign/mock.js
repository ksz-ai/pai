/* ============================================================
   mock.js — 全站唯一数据源（静态原型，所有页面共享）
   数据均为演示用虚构内容，字段结构对齐未来真实接口
   ============================================================ */
window.DB = {
  user: {
    name: "林致远",
    letter: "林",
    school: "河南大学 · 软件工程 2024 级",
    streak: 12,
    days: 46,
    persona: "通用讲解"
  },

  stats: {
    weeklyMinutes: [42, 65, 38, 0, 80, 55, 26],
    weekLabels: ["一", "二", "三", "四", "五", "六", "日"],
    mastered: 7,
    learning: 12,
    notesCount: 12,
    reviewDue: 4
  },

  domains: ["Transformer", "深度学习基础", "Python 工程", "论文复现", "数学基础"],

  conversations: [
    {
      id: "c1",
      title: "为什么 Transformer 需要位置编码？",
      domain: "Transformer",
      updatedAt: "今天 09:42",
      depth: "L2",
      messageCount: 24,
      summary: "从自注意力的置换不变性讲到正弦编码与 RoPE 的取舍，最后回到一句话直觉。",
      pinned: true
    },
    {
      id: "c2",
      title: "多头注意力里每个头到底学到了什么",
      domain: "Transformer",
      updatedAt: "昨天 21:10",
      depth: "L2",
      messageCount: 18,
      summary: "用可视化实验说明不同头的分工，并区分「可解释」与「事后叙事」。",
      pinned: false
    },
    {
      id: "c3",
      title: "PyTorch 里 nn.Module 的 forward 怎么被调用",
      domain: "Python 工程",
      updatedAt: "昨天 15:26",
      depth: "L1",
      messageCount: 12,
      summary: "顺着 __call__ → forward 的链路，解释 hook 与参数注册的时机。",
      pinned: false
    },
    {
      id: "c4",
      title: "论文复现：ViT 的 patch embedding 细节",
      domain: "论文复现",
      updatedAt: "2 天前",
      depth: "L2",
      messageCount: 31,
      summary: "卷积核与 Linear 投影两种实现等价性，以及 stride 与重叠切块的差异。",
      pinned: true
    },
    {
      id: "c5",
      title: "交叉熵和 KL 散度到底差在哪",
      domain: "数学基础",
      updatedAt: "3 天前",
      depth: "L1",
      messageCount: 9,
      summary: "从信息量出发推导 KL，再说明训练时省略的常数项为何不影响梯度。",
      pinned: false
    },
    {
      id: "c6",
      title: "LayerNorm 为什么放在残差之后（Post-LN）",
      domain: "Transformer",
      updatedAt: "4 天前",
      depth: "L1",
      messageCount: 15,
      summary: "Post-LN 与 Pre-LN 的梯度尺度差异，以及 warmup 存在的真实原因。",
      pinned: false
    },
    {
      id: "c7",
      title: "用 numpy 手写 softmax 的数值稳定性",
      domain: "深度学习基础",
      updatedAt: "5 天前",
      depth: "L0",
      messageCount: 7,
      summary: "减去最大值、log-sum-exp 技巧，以及溢出为什么会发生在 exp 而不是除法。",
      pinned: false
    },
    {
      id: "c8",
      title: "学习率 warmup 为什么对 Transformer 有效",
      domain: "深度学习基础",
      updatedAt: "6 天前",
      depth: "L1",
      messageCount: 11,
      summary: "初期梯度方差大、Adam 二阶矩估计不稳，warmup 实质是给估计器收敛时间。",
      pinned: false
    }
  ],

  messages: [
    {
      id: "m1",
      role: "user",
      content: "为什么 Transformer 需要位置编码？自注意力不是已经能看到所有词了吗？",
      time: "09:31",
      depth: null
    },
    {
      id: "m2",
      role: "assistant",
      depth: "L1",
      time: "09:32",
      feedback: null,
      content:
        "<p>能看到所有词，不等于知道它们的<strong>顺序</strong>。自注意力的计算本质是一组加权求和，而权重只由 query 和 key 的相似度决定——把句子打乱，权重矩阵只是被同时置换，输出集合完全一样。</p>" +
        '<p class="formula">Attention(Q,K,V) = softmax(QKᵀ / √d) · V</p>' +
        "<p>这个性质叫<strong>置换等变性</strong>。所以模型拿到的只是「有哪些词、彼此多相关」，没有「谁在前谁在后」。位置编码就是把顺序信息以可学习或可计算的方式注入到 token 表示里：</p>" +
        "<ul><li>绝对位置：给每个位置一个向量，直接相加（正弦编码、可学习 embedding）</li><li>相对位置：让注意力打分本身感知两个 token 的距离（RoPE、ALiBi）</li></ul>" +
        "<p>一句话：<strong>自注意力负责「谁和谁相关」，位置编码负责「谁先谁后」</strong>，两者缺一不可。</p>",
      why:
        "<strong>为什么讲这么深？</strong><p>你上次在「自注意力」上完成了一次正确应用（+0.2），但「置换不变性」只有一次模糊提及。按画像判档为 L1：先给结论，再补一段原理，不展开完整推导。</p>"
    },
    {
      id: "m3",
      role: "user",
      content: "那正弦编码和 RoPE 有什么区别？为什么现在的模型都用 RoPE？",
      time: "09:36",
      depth: null
    },
    {
      id: "m4",
      role: "assistant",
      depth: "L2",
      time: "09:37",
      feedback: "helpful",
      content:
        "<p>直接对比两者的<strong>作用位置</strong>：正弦编码是「加在输入上」，RoPE 是「乘在注意力里」。</p>" +
        "<h3>正弦编码（绝对位置）</h3>" +
        "<p>给位置 <code class='inline'>pos</code> 生成一组不同频率的 sin/cos，与词向量相加。它的问题是：模型只能从「加了什么」间接推断距离，外推到更长序列时性能明显下降。</p>" +
        "<h3>RoPE（旋转位置编码）</h3>" +
        "<p>把 query 和 key 的每一对维度看成二维平面上的点，按位置角度旋转。两个 token 做点积时，结果只与它们的<strong>相对角度</strong>有关：</p>" +
        '<p class="formula">⟨R(θ_i)q, R(θ_j)k⟩ = f(q, k, i − j)</p>' +
        "<p>因此 RoPE 天然表达相对位置，且不改变向量模长。这也是它成为主流的原因——不是「更先进」，而是<strong>把相对性直接写进了运算结构</strong>。</p>" +
        "<ul><li>正弦编码：加法注入，绝对位置，外推弱</li><li>RoPE：旋转注入，相对位置，长度外推可用插值/缩放改善</li><li>ALiBi：给注意力加距离惩罚，更轻但表达力有限</li></ul>",
      why:
        "<strong>为什么升到 L2？</strong><p>你在追问中主动比较了两个方案，并使用了「相对」这一关键限定词，掌握度从 0.42 上调到 0.58，进入 L2 增量讲解档位，因此补充了公式与方案对比。</p>"
    },
    {
      id: "m5",
      role: "user",
      content: "我还是不太懂「相对位置能被点积表达」这一步，旋转为什么不会破坏原来的语义？",
      time: "09:40",
      depth: null
    },
    {
      id: "m6",
      role: "assistant",
      depth: "L0",
      time: "09:41",
      feedback: null,
      content:
        "<p>换个角度，先不谈公式。把每个词向量想象成一根<strong>指针</strong>：它的方向表示「语义」，长度表示「强度」。</p>" +
        "<ul><li>旋转只改方向，不改长度——所以语义强度不变</li><li>两个指针的夹角决定点积大小：夹角越小越相关</li><li>如果两个指针都按位置转了相同角度，它们之间的<strong>夹角不变</strong>；转的角度差，正好就是位置差</li></ul>" +
        "<p>所以「相对位置被点积表达」= <strong>位置只改变夹角，而夹角差只由位置差决定</strong>。原来的语义方向没有被抹掉，只是被整体旋转了。</p>" +
        "<p>你可以先用这个直觉理解，等下次我们再补复数形式和推导。</p>",
      why:
        "<strong>为什么降到 L0？</strong><p>上一轮你连续两次表示「没懂」，且没有给出可验证的应用证据，系统判定当前概念卡在定义层，自动降到最小必要深度，改用单一类比，暂不引入新符号。</p>"
    }
  ],

  concepts: [
    { id: "k1", name: "自注意力", domain: "Transformer", mastery: 0.62, protected: false, updatedAt: "今天", evidence: [{ convId: "c1", at: "09:32", quote: "权重只由 query 和 key 的相似度决定" }] },
    { id: "k2", name: "位置编码", domain: "Transformer", mastery: 0.34, protected: false, updatedAt: "今天", evidence: [{ convId: "c1", at: "09:41", quote: "位置只改变夹角，而夹角差只由位置差决定" }] },
    { id: "k3", name: "RoPE", domain: "Transformer", mastery: 0.28, protected: false, updatedAt: "今天", evidence: [{ convId: "c1", at: "09:37", quote: "把 query 和 key 的每一对维度看成二维平面上的点" }] },
    { id: "k4", name: "置换不变性", domain: "Transformer", mastery: 0.21, protected: false, updatedAt: "今天", evidence: [{ convId: "c1", at: "09:32", quote: "把句子打乱，权重矩阵只是被同时置换" }] },
    { id: "k5", name: "多头注意力", domain: "Transformer", mastery: 0.55, protected: false, updatedAt: "昨天", evidence: [{ convId: "c2", at: "21:10", quote: "不同头在不同子空间里做同样的加权求和" }] },
    { id: "k6", name: "LayerNorm", domain: "Transformer", mastery: 0.47, protected: true, updatedAt: "4 天前", evidence: [{ convId: "c6", at: "10:24", quote: "Pre-LN 把归一化放在子层入口，梯度更平稳" }] },
    { id: "k7", name: "反向传播", domain: "深度学习基础", mastery: 0.68, protected: false, updatedAt: "5 天前", evidence: [{ convId: "c7", at: "16:02", quote: "链式法则把上游梯度逐层乘下来" }] },
    { id: "k8", name: "数值稳定性", domain: "深度学习基础", mastery: 0.44, protected: false, updatedAt: "5 天前", evidence: [{ convId: "c7", at: "16:15", quote: "减去最大值不会改变 softmax 结果" }] },
    { id: "k9", name: "nn.Module", domain: "Python 工程", mastery: 0.51, protected: false, updatedAt: "昨天", evidence: [{ convId: "c3", at: "15:30", quote: "__call__ 负责 hook，forward 只关心计算" }] },
    { id: "k10", name: "patch embedding", domain: "论文复现", mastery: 0.39, protected: false, updatedAt: "2 天前", evidence: [{ convId: "c4", at: "11:08", quote: "卷积实现与 Linear 投影在权重上可以互相转换" }] },
    { id: "k11", name: "KL 散度", domain: "数学基础", mastery: 0.58, protected: false, updatedAt: "3 天前", evidence: [{ convId: "c5", at: "20:41", quote: "KL = 交叉熵 − 真实分布的熵" }] },
    { id: "k12", name: "warmup", domain: "深度学习基础", mastery: 0.33, protected: false, updatedAt: "6 天前", evidence: [{ convId: "c8", at: "09:55", quote: "二阶矩估计在初期方差很大，需要一个收敛窗口" }] }
  ],

  notes: [
    {
      id: "n1",
      title: "位置编码：从正弦到 RoPE",
      domain: "Transformer",
      updatedAt: "今天 10:05",
      tags: ["位置编码", "RoPE", "注意力"],
      excerpt: "自注意力本身对顺序不敏感，位置编码负责补齐「谁先谁后」。本文对比加法式与旋转式两条路线。",
      concepts: ["位置编码", "RoPE", "置换不变性"],
      words: 1460,
      status: "已导出",
      pinned: true
    },
    {
      id: "n2",
      title: "多头注意力：分工是真实存在的吗",
      domain: "Transformer",
      updatedAt: "昨天 21:40",
      tags: ["注意力", "可解释性"],
      excerpt: "用注意力热力图与消融实验说明头的功能分化，并提醒「事后叙事」的解释风险。",
      concepts: ["多头注意力", "自注意力"],
      words: 980,
      status: "草稿",
      pinned: false
    },
    {
      id: "n3",
      title: "nn.Module 的调用链与 hook 时机",
      domain: "Python 工程",
      updatedAt: "昨天 15:50",
      tags: ["PyTorch", "源码"],
      excerpt: "从 __call__ 到 forward、从参数注册到 hook 触发，梳理一次前向里到底发生了什么。",
      concepts: ["nn.Module"],
      words: 1120,
      status: "草稿",
      pinned: false
    },
    {
      id: "n4",
      title: "ViT patch embedding 的两种等价实现",
      domain: "论文复现",
      updatedAt: "2 天前",
      tags: ["ViT", "复现笔记"],
      excerpt: "卷积切块 + 展平 与 Linear 投影在数学上等价，差别只在权重形状与实现效率。",
      concepts: ["patch embedding", "ViT"],
      words: 1730,
      status: "草稿",
      pinned: true
    },
    {
      id: "n5",
      title: "交叉熵、KL 散度与最大似然",
      domain: "数学基础",
      updatedAt: "3 天前",
      tags: ["信息论", "损失函数"],
      excerpt: "三者不是三个概念，而是同一个量在不同约束下的写法；训练时省略的常数项不影响梯度。",
      concepts: ["KL 散度", "交叉熵"],
      words: 860,
      status: "已导出",
      pinned: false
    },
    {
      id: "n6",
      title: "Pre-LN 与 Post-LN 的梯度差异",
      domain: "Transformer",
      updatedAt: "4 天前",
      tags: ["LayerNorm", "训练稳定性"],
      excerpt: "Post-LN 输出尺度随深度放大，需要 warmup 兜底；Pre-LN 更稳但表达略有损失。",
      concepts: ["LayerNorm", "warmup"],
      words: 1240,
      status: "草稿",
      pinned: false
    },
    {
      id: "n7",
      title: "softmax 数值稳定性的三种写法",
      domain: "深度学习基础",
      updatedAt: "5 天前",
      tags: ["numpy", "数值计算"],
      excerpt: "减去最大值、log-sum-exp、以及为什么 exp 先溢出而不是除法先溢出。",
      concepts: ["数值稳定性", "softmax"],
      words: 640,
      status: "草稿",
      pinned: false
    },
    {
      id: "n8",
      title: "warmup 的本质：给二阶矩估计一个窗口",
      domain: "深度学习基础",
      updatedAt: "6 天前",
      tags: ["优化器", "训练技巧"],
      excerpt: "从 Adam 的偏差修正出发，解释 warmup 不是玄学，而是在补偿估计器初期的高方差。",
      concepts: ["warmup", "Adam"],
      words: 780,
      status: "草稿",
      pinned: false
    },
    {
      id: "n9",
      title: "PyTorch 数据加载的常见坑",
      domain: "Python 工程",
      updatedAt: "8 天前",
      tags: ["DataLoader", "多进程"],
      excerpt: "num_workers 与随机种子、pin_memory 的取舍、以及自定义 collate 的边界情况。",
      concepts: ["DataLoader"],
      words: 920,
      status: "草稿",
      pinned: false
    },
    {
      id: "n10",
      title: "论文复现的检查清单",
      domain: "论文复现",
      updatedAt: "10 天前",
      tags: ["方法论", "复现"],
      excerpt: "从数据划分、超参对齐到随机性控制，列出一份可逐项打勾的复现清单。",
      concepts: ["复现方法"],
      words: 1350,
      status: "已导出",
      pinned: false
    },
    {
      id: "n11",
      title: "矩阵求导：从标量到张量",
      domain: "数学基础",
      updatedAt: "12 天前",
      tags: ["矩阵求导", "推导"],
      excerpt: "用维度对齐法检查求导结果，避免在链式法则里迷失形状。",
      concepts: ["矩阵求导"],
      words: 1080,
      status: "草稿",
      pinned: false
    },
    {
      id: "n12",
      title: "注意力机制中的 mask 类型汇总",
      domain: "Transformer",
      updatedAt: "14 天前",
      tags: ["mask", "注意力"],
      excerpt: "padding mask、causal mask、以及二者组合时的形状与广播规则。",
      concepts: ["自注意力", "mask"],
      words: 760,
      status: "草稿",
      pinned: false
    }
  ],

  noteDetail: {
    id: "n1",
    title: "位置编码：从正弦到 RoPE",
    domain: "Transformer",
    sourceTitle: "为什么 Transformer 需要位置编码？",
    sourceConvId: "c1",
    date: "2026-10-30",
    anchors: [
      { id: "a1", convId: "c1", quote: "把句子打乱，权重矩阵只是被同时置换，输出集合完全一样。", at: "09:32" },
      { id: "a2", convId: "c1", quote: "用正弦/余弦的不同频率给每个位置一个可计算的向量。", at: "09:33" },
      { id: "a3", convId: "c1", quote: "把 query 和 key 的每一对维度看成二维平面上的点，按位置角度旋转。", at: "09:37" }
    ],
    sections: [
      {
        h: "概念定义",
        body:
          "<p>位置编码（Positional Encoding）是把 token 在序列中的位置信息注入模型表示的一类方法。Transformer 的自注意力对输入顺序具有置换等变性，若不注入位置，模型无法区分「猫追狗」与「狗追猫」。</p>" +
          "<p>按注入方式可分为两条路线：<strong>加法式</strong>（正弦编码、可学习 embedding）与<strong>乘法/旋转式</strong>（RoPE）。<span class='anchor' data-anchor='a1'>a1</span></p>"
      },
      {
        h: "直觉类比",
        body:
          "<p>把每个词向量想象成一根指针：方向是语义，长度是强度。注意力比较的是两根指针的夹角。</p>" +
          "<ul><li>位置编码只旋转指针，不改变长度 → 语义强度不被破坏</li><li>两个指针各自旋转后，它们之间的夹角差只由位置差决定 → 相对位置被自然表达</li></ul>" +
          "<p>这就是 RoPE 的核心直觉：<strong>位置不是加进去的信息，而是旋转的角度</strong>。</p>"
      },
      {
        h: "数学形式",
        body:
          "<p>正弦编码给位置 pos 的每一维分配不同频率：</p>" +
          "<p class='formula'>PE(pos, 2i) = sin(pos / 10000^(2i/d))<br>PE(pos, 2i+1) = cos(pos / 10000^(2i/d))</p>" +
          "<p>RoPE 则对 query/key 的成对维度做旋转：</p>" +
          "<p class='formula'>q' = R(θ_pos) · q,&nbsp;&nbsp; k' = R(θ_pos) · k<br>⟨q'_i, k'_j⟩ = f(q_i, k_j, i − j)</p>" +
          "<p>关键结论：点积结果只依赖相对位移 <code class='inline'>i − j</code>，与绝对位置无关。<span class='anchor' data-anchor='a3'>a3</span></p>"
      },
      {
        h: "代码对应",
        body:
          "<p>最小可运行片段（PyTorch 风格伪代码）：</p>" +
          "<p class='formula'>inv_freq = 1.0 / (10000 ** (torch.arange(0, d, 2) / d))<br>angles = pos[:, None] * inv_freq[None, :]<br>emb = torch.cat([angles.sin(), angles.cos()], dim=-1)<br>x = token_embed + emb&nbsp;&nbsp;# 加法式</p>" +
          "<p>RoPE 的差异在于：不对 embedding 做加法，而是在注意力计算前对 q、k 施加旋转矩阵。</p>"
      },
      {
        h: "常见误区",
        body:
          "<ul><li><strong>「位置编码让模型知道绝对位置」</strong>：正弦编码并不直接提供绝对索引，模型需要从频率组合中间接推断。</li>" +
          "<li><strong>「RoPE 一定比正弦好」</strong>：在短序列任务上差异有限；RoPE 的优势主要出现在长序列与相对关系敏感的场景。</li>" +
          "<li><strong>「位置编码可以随意外推」</strong>：直接外推通常失败，需要插值、缩放或继续训练。</li></ul>"
      },
      {
        h: "自检问题",
        body:
          "<ul><li>如果把位置编码全设为 0，模型在哪些任务上会立刻退化？</li><li>为什么 RoPE 的旋转不改变向量模长？这与梯度稳定有关吗？</li><li>ALiBi 与 RoPE 在「相对位置」上的表达方式有何本质不同？</li></ul>" +
          "<p>答不上来的题会自动进入复习队列，明天优先出现。</p>"
      }
    ],
    glossary: [
      { term: "置换等变性", def: "输入顺序改变时，输出只是被同样地重排，函数值结构不变。自注意力正是这种性质。" },
      { term: "RoPE", def: "Rotary Position Embedding，用旋转矩阵把相对位置编码进 query/key 的点积。" },
      { term: "外推", def: "模型在比训练时更长的序列上仍保持性能的能力。" },
      { term: "ALiBi", def: "Attention with Linear Biases，直接在注意力分数上加与距离成正比的惩罚项。" }
    ],
    cards: [
      { front: "自注意力为什么无法感知顺序？", back: "权重只由 q、k 相似度决定，打乱输入只会同时置换权重矩阵。" },
      { front: "正弦编码注入在哪一步？", back: " token embedding 上做逐元素相加，属于绝对位置编码。" },
      { front: "RoPE 的旋转改变了什么？", back: "只改变 q/k 的方向，不改变模长；点积结果依赖相对角度。" },
      { front: "长序列外推失败的两个常见补救？", back: "位置插值（PI）与频率缩放（NTK-aware scaling）。" },
      { front: "ALiBi 与 RoPE 的差别？", back: "ALiBi 在注意力分数加距离惩罚，RoPE 旋转向量本身。" }
    ]
  },

  reviewQueue: [
    { id: "r1", noteId: "n1", concept: "位置编码", due: "今天", interval: 3, lastGrade: "unknown" },
    { id: "r2", noteId: "n1", concept: "RoPE", due: "今天", interval: 2, lastGrade: "unknown" },
    { id: "r3", noteId: "n6", concept: "LayerNorm", due: "今天", interval: 4, lastGrade: "known" },
    { id: "r4", noteId: "n8", concept: "warmup", due: "今天", interval: 2, lastGrade: "unknown" },
    { id: "r5", noteId: "n2", concept: "多头注意力", due: "明天", interval: 5, lastGrade: "known" },
    { id: "r6", noteId: "n5", concept: "KL 散度", due: "明天", interval: 6, lastGrade: "known" },
    { id: "r7", noteId: "n7", concept: "数值稳定性", due: "明天", interval: 3, lastGrade: "unknown" },
    { id: "r8", noteId: "n3", concept: "nn.Module", due: "2 天后", interval: 7, lastGrade: "known" },
    { id: "r9", noteId: "n4", concept: "patch embedding", due: "2 天后", interval: 5, lastGrade: "unknown" },
    { id: "r10", noteId: "n11", concept: "矩阵求导", due: "3 天后", interval: 9, lastGrade: "known" }
  ],

  settings: {
    provider: "DeepSeek",
    model: "deepseek-chat",
    keyMasked: "sk-••••••••••••9f2a",
    budget: 32000,
    persona: "general",
    notify: true,
    autoCompact: true
  },

  personas: [
    { key: "general", name: "通用讲解", desc: "先结论后原理，按掌握度调深度", icon: "graduation-cap" },
    { key: "socratic", name: "苏格拉底", desc: "多用追问，让你自己补全推理", icon: "circle-help" },
    { key: "coach", name: "教练", desc: "强调可执行步骤与练习反馈", icon: "target" },
    { key: "minimal", name: "极简", desc: "只给一句话与一个式子", icon: "zap" }
  ],

  providers: [
    { key: "zhipu", name: "智谱 GLM", desc: "国内直连 · glm-4" },
    { key: "deepseek", name: "DeepSeek", desc: "推理强 · deepseek-chat" },
    { key: "kimi", name: "Kimi", desc: "长上下文 · kimi-k2" },
    { key: "openai", name: "OpenAI", desc: "需代理 · gpt-4.1-mini" },
    { key: "custom", name: "自定义", desc: "任意 OpenAI 兼容端点" }
  ],

  modelsByProvider: {
    zhipu: ["glm-4", "glm-4-flash", "glm-4-long"],
    deepseek: ["deepseek-chat", "deepseek-reasoner"],
    kimi: ["kimi-k2", "kimi-k2-turbo"],
    openai: ["gpt-4.1-mini", "gpt-4.1"],
    custom: ["自定义模型名"]
  },

  profileLogs: [
    { at: "今天 09:41", concept: "位置编码", from: 0.42, to: 0.34, signal: "反馈「没懂」", detail: "连续两次表示未理解，按 -0.15 上限扣减，并触发降档。" },
    { at: "今天 09:37", concept: "RoPE", from: 0.18, to: 0.28, signal: "追问质量", detail: "主动比较两种方案，记为一次应用证据 +0.1。" },
    { at: "昨天 21:10", concept: "多头注意力", from: 0.45, to: 0.55, signal: "手动纠错", detail: "你手动上调 0.1，保护期 30 天内不再被系统下调。" },
    { at: "4 天前 10:24", concept: "LayerNorm", from: 0.57, to: 0.47, signal: "反馈「太浅」", detail: "要求更深讲解，系统记录一次负向信号。" },
    { at: "6 天前 09:55", concept: "warmup", from: 0.25, to: 0.33, signal: "提问初始值", detail: "首次提问建立条目，初始掌握度 0.3，经一次正确应用后 +0.03。" }
  ]
};
