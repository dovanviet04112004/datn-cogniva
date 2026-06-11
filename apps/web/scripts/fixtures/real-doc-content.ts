export type Block =
  | { type: 'h'; text: string }
  | { type: 'p'; text: string }
  | { type: 'b'; text: string }
  | { type: 'f'; text: string }
  | { type: 'code'; text: string };

export type DocContent = {
  match: string;
  blocks: Block[];
};

export const REAL_CONTENTS: DocContent[] = [
  {
    match: 'dao ham',
    blocks: [
      { type: 'h', text: '1. Định nghĩa đạo hàm' },
      {
        type: 'p',
        text: 'Đạo hàm của hàm số y = f(x) tại điểm x₀ là giới hạn của tỉ số số gia hàm số trên số gia đối số khi số gia đối số dần về 0:',
      },
      { type: 'f', text: "f'(x₀) = lim(Δx→0) [f(x₀+Δx) − f(x₀)] / Δx" },
      {
        type: 'p',
        text: 'Về mặt hình học, f′(x₀) là hệ số góc của tiếp tuyến với đồ thị hàm số tại điểm (x₀; f(x₀)). Về mặt vật lý, đạo hàm biểu thị tốc độ biến thiên tức thời của đại lượng.',
      },
      { type: 'h', text: '2. Các quy tắc tính đạo hàm' },
      { type: 'b', text: "(u ± v)' = u' ± v'" },
      { type: 'b', text: "(u·v)' = u'·v + u·v'" },
      { type: 'b', text: "(u/v)' = (u'·v − u·v') / v²  (v ≠ 0)" },
      { type: 'b', text: "Đạo hàm hàm hợp: [f(g(x))]' = f'(g(x))·g'(x)" },
      { type: 'h', text: '3. Bảng đạo hàm cơ bản' },
      { type: 'f', text: "(xⁿ)' = n·xⁿ⁻¹     (sin x)' = cos x     (cos x)' = −sin x" },
      { type: 'f', text: "(eˣ)' = eˣ     (ln x)' = 1/x     (aˣ)' = aˣ·ln a" },
      { type: 'h', text: '4. Ứng dụng: khảo sát hàm số' },
      {
        type: 'p',
        text: 'Hàm số đồng biến trên khoảng K khi f′(x) ≥ 0 với mọi x ∈ K (dấu = chỉ tại hữu hạn điểm). Nghịch biến khi f′(x) ≤ 0. Điểm cực trị là nghiệm của f′(x) = 0 mà f′ đổi dấu.',
      },
      {
        type: 'p',
        text: 'Ví dụ: y = x³ − 3x + 2. Ta có y′ = 3x² − 3 = 3(x−1)(x+1). y′ = 0 ⟺ x = ±1. Lập bảng biến thiên: hàm đạt cực đại tại x = −1 (y = 4), cực tiểu tại x = 1 (y = 0).',
      },
      { type: 'h', text: '5. Bài tập tự luyện' },
      { type: 'b', text: "Tính đạo hàm: y = (2x² + 1)⁵. ĐS: y' = 20x(2x²+1)⁴." },
      {
        type: 'b',
        text: 'Tìm cực trị của y = x⁴ − 2x². ĐS: cực tiểu tại x = ±1, cực đại tại x = 0.',
      },
      { type: 'b', text: 'Viết phương trình tiếp tuyến của y = x² tại x₀ = 2. ĐS: y = 4x − 4.' },
    ],
  },
  {
    match: 'tich phan',
    blocks: [
      { type: 'h', text: '1. Nguyên hàm và tích phân' },
      {
        type: 'p',
        text: 'F(x) là nguyên hàm của f(x) nếu F′(x) = f(x). Tích phân xác định trên [a;b] tính theo công thức Newton–Leibniz:',
      },
      { type: 'f', text: '∫ₐᵇ f(x)dx = F(b) − F(a)' },
      { type: 'h', text: '2. Bảng nguyên hàm cơ bản' },
      { type: 'f', text: '∫ xⁿ dx = xⁿ⁺¹/(n+1) + C   (n ≠ −1)' },
      { type: 'f', text: '∫ 1/x dx = ln|x| + C     ∫ eˣ dx = eˣ + C' },
      { type: 'f', text: '∫ sin x dx = −cos x + C     ∫ cos x dx = sin x + C' },
      { type: 'h', text: '3. Phương pháp đổi biến số' },
      {
        type: 'p',
        text: 'Đặt t = u(x) ⟹ dt = u′(x)dx. Đổi cận theo t. Ví dụ tính ∫₀¹ 2x·(x²+1)³ dx: đặt t = x²+1, dt = 2x dx. Khi x=0 thì t=1, x=1 thì t=2. Tích phân thành ∫₁² t³ dt = [t⁴/4]₁² = (16−1)/4 = 15/4.',
      },
      { type: 'h', text: '4. Phương pháp tính nhanh từng phần' },
      { type: 'f', text: '∫ u dv = u·v − ∫ v du' },
      {
        type: 'p',
        text: 'Quy tắc chọn u theo thứ tự ưu tiên LIATE (Logarit – Inverse – Đại số – Lượng giác – Mũ). Ví dụ ∫ x·eˣ dx: chọn u = x, dv = eˣdx ⟹ = x·eˣ − ∫ eˣ dx = eˣ(x−1) + C.',
      },
      { type: 'h', text: '5. Ứng dụng tính diện tích' },
      {
        type: 'p',
        text: 'Diện tích hình phẳng giới hạn bởi y = f(x), trục Ox, x = a, x = b: S = ∫ₐᵇ |f(x)| dx. Thể tích khối tròn xoay quanh Ox: V = π∫ₐᵇ f(x)² dx.',
      },
    ],
  },
  {
    match: 'luong giac',
    blocks: [
      { type: 'h', text: '1. Công thức lượng giác cơ bản' },
      { type: 'f', text: 'sin²x + cos²x = 1     tan x = sin x / cos x' },
      { type: 'f', text: '1 + tan²x = 1/cos²x     1 + cot²x = 1/sin²x' },
      { type: 'h', text: '2. Công thức cộng' },
      { type: 'f', text: 'sin(a ± b) = sin a·cos b ± cos a·sin b' },
      { type: 'f', text: 'cos(a ± b) = cos a·cos b ∓ sin a·sin b' },
      { type: 'f', text: 'tan(a ± b) = (tan a ± tan b)/(1 ∓ tan a·tan b)' },
      { type: 'h', text: '3. Công thức nhân đôi' },
      { type: 'f', text: 'sin 2a = 2 sin a cos a     cos 2a = cos²a − sin²a = 2cos²a − 1' },
      { type: 'h', text: '4. Phương trình lượng giác cơ bản' },
      { type: 'b', text: 'sin x = sin α ⟺ x = α + k2π hoặc x = π − α + k2π' },
      { type: 'b', text: 'cos x = cos α ⟺ x = ±α + k2π' },
      { type: 'b', text: 'tan x = tan α ⟺ x = α + kπ' },
      { type: 'h', text: '5. Bài tập' },
      { type: 'b', text: 'Giải 2sin x − 1 = 0. ĐS: x = π/6 + k2π hoặc x = 5π/6 + k2π.' },
      { type: 'b', text: 'Rút gọn A = sin(π/2 − x) + cos(π − x). ĐS: A = cos x − cos x = 0.' },
    ],
  },
  {
    match: 'oxyz',
    blocks: [
      { type: 'h', text: '1. Hệ toạ độ trong không gian' },
      {
        type: 'p',
        text: 'Mỗi điểm M trong không gian xác định bởi bộ ba toạ độ (x; y; z). Vectơ AB = (xB−xA; yB−yA; zB−zA). Độ dài: |AB| = √[(Δx)² + (Δy)² + (Δz)²].',
      },
      { type: 'h', text: '2. Tích vô hướng và tích có hướng' },
      { type: 'f', text: 'a·b = x₁x₂ + y₁y₂ + z₁z₂ = |a||b|cosφ' },
      {
        type: 'p',
        text: 'Tích có hướng [a,b] vuông góc với cả a và b, dùng để tính diện tích tam giác S = ½|[AB,AC]| và thể tích tứ diện V = ⅙|[AB,AC]·AD|.',
      },
      { type: 'h', text: '3. Phương trình mặt phẳng' },
      { type: 'f', text: 'A(x−x₀) + B(y−y₀) + C(z−z₀) = 0,  vtpt n = (A;B;C)' },
      { type: 'h', text: '4. Phương trình đường thẳng' },
      { type: 'f', text: 'Tham số: x = x₀+at, y = y₀+bt, z = z₀+ct  (vtcp u = (a;b;c))' },
      { type: 'h', text: '5. Bài tập có lời giải' },
      {
        type: 'p',
        text: 'Cho A(1;0;0), B(0;2;0), C(0;0;3). Viết phương trình mặt phẳng (ABC). Giải: mặt phẳng theo đoạn chắn x/1 + y/2 + z/3 = 1 ⟺ 6x + 3y + 2z − 6 = 0.',
      },
    ],
  },
  {
    match: 'tot nghiep thpt toan',
    blocks: [
      { type: 'h', text: 'ĐỀ THI TỐT NGHIỆP THPT — MÔN TOÁN' },
      {
        type: 'p',
        text: 'Thời gian làm bài: 90 phút, 50 câu trắc nghiệm. Dưới đây là một số câu tiêu biểu kèm lời giải.',
      },
      { type: 'h', text: 'Câu 1 (Đạo hàm)' },
      {
        type: 'p',
        text: 'Cho hàm y = x³ − 3x² + 1. Số điểm cực trị là? Giải: y′ = 3x² − 6x = 3x(x−2), y′=0 tại x=0 và x=2, đổi dấu 2 lần ⟹ 2 điểm cực trị. Đáp án: 2.',
      },
      { type: 'h', text: 'Câu 2 (Logarit)' },
      {
        type: 'p',
        text: 'Giải phương trình log₂(x−1) = 3. Giải: x − 1 = 2³ = 8 ⟹ x = 9. Đáp án: x = 9.',
      },
      { type: 'h', text: 'Câu 3 (Tích phân)' },
      {
        type: 'p',
        text: 'Tính I = ∫₀¹ (3x² + 2x) dx. Giải: I = [x³ + x²]₀¹ = 1 + 1 = 2. Đáp án: 2.',
      },
      { type: 'h', text: 'Câu 4 (Số phức)' },
      { type: 'p', text: 'Cho z = 3 − 4i. Tính |z|. Giải: |z| = √(3² + 4²) = √25 = 5. Đáp án: 5.' },
      { type: 'h', text: 'Câu 5 (Hình Oxyz)' },
      {
        type: 'p',
        text: 'Khoảng cách từ M(1;2;2) đến mặt phẳng (P): x + 2y + 2z − 3 = 0. Giải: d = |1+4+4−3|/√(1+4+4) = 6/3 = 2. Đáp án: 2.',
      },
    ],
  },
  {
    match: 'dao dong co',
    blocks: [
      { type: 'h', text: '1. Dao động điều hoà' },
      {
        type: 'p',
        text: 'Dao động điều hoà là dao động trong đó li độ là hàm cosin (hoặc sin) theo thời gian:',
      },
      { type: 'f', text: 'x = A·cos(ωt + φ)' },
      { type: 'b', text: 'A: biên độ (m) — li độ cực đại' },
      { type: 'b', text: 'ω: tần số góc (rad/s), ω = 2π/T = 2πf' },
      { type: 'b', text: 'φ: pha ban đầu (rad)' },
      { type: 'h', text: '2. Vận tốc và gia tốc' },
      { type: 'f', text: 'v = x′ = −Aω·sin(ωt+φ),  v_max = Aω' },
      { type: 'f', text: 'a = v′ = −Aω²·cos(ωt+φ) = −ω²x,  a_max = Aω²' },
      {
        type: 'p',
        text: 'Vận tốc sớm pha π/2 so với li độ; gia tốc ngược pha với li độ. Hệ thức độc lập thời gian: A² = x² + v²/ω².',
      },
      { type: 'h', text: '3. Con lắc lò xo' },
      { type: 'f', text: 'ω = √(k/m),  T = 2π√(m/k)' },
      {
        type: 'p',
        text: 'Cơ năng W = ½kA² = ½mω²A² bảo toàn (bỏ qua ma sát). Động năng và thế năng biến thiên tuần hoàn với chu kỳ T/2.',
      },
      { type: 'h', text: '4. Con lắc đơn' },
      { type: 'f', text: 'T = 2π√(l/g)' },
      {
        type: 'p',
        text: 'Chu kỳ con lắc đơn chỉ phụ thuộc chiều dài l và gia tốc trọng trường g, không phụ thuộc khối lượng (dao động nhỏ, góc < 10°).',
      },
      { type: 'h', text: '5. Bài tập' },
      {
        type: 'p',
        text: 'Vật dao động x = 5cos(4πt) cm. Tìm v_max. Giải: A = 5cm = 0,05m; ω = 4π. v_max = Aω = 0,05·4π ≈ 0,628 m/s = 62,8 cm/s.',
      },
    ],
  },
  {
    match: 'de thi thu vat ly',
    blocks: [
      { type: 'h', text: 'ĐỀ THI THỬ VẬT LÝ THPT — Tuyển chọn' },
      { type: 'p', text: '40 câu / 50 phút. Trích một số câu kèm đáp án giải thích.' },
      { type: 'h', text: 'Câu 1 — Dao động' },
      {
        type: 'p',
        text: 'Con lắc lò xo k = 100 N/m, m = 100g. Tính chu kỳ. Giải: T = 2π√(m/k) = 2π√(0,1/100) = 2π·0,0316 ≈ 0,2s.',
      },
      { type: 'h', text: 'Câu 2 — Sóng cơ' },
      { type: 'p', text: 'Sóng có f = 50 Hz, v = 200 m/s. Bước sóng λ = v/f = 200/50 = 4 m.' },
      { type: 'h', text: 'Câu 3 — Điện xoay chiều' },
      {
        type: 'p',
        text: 'Mạch RLC, công suất cực đại khi cộng hưởng: ZL = ZC ⟺ ω²LC = 1. Khi đó hệ số công suất cosφ = 1.',
      },
      { type: 'h', text: 'Câu 4 — Sóng ánh sáng' },
      {
        type: 'p',
        text: 'Khoảng vân i = λD/a. Với λ = 0,6μm, D = 2m, a = 1mm: i = 0,6·10⁻⁶·2/10⁻³ = 1,2·10⁻³ m = 1,2 mm.',
      },
    ],
  },
  {
    match: 'este',
    blocks: [
      { type: 'h', text: '1. Khái niệm Este' },
      {
        type: 'p',
        text: 'Este là sản phẩm thay nhóm −OH của axit cacboxylic bằng nhóm −OR′. Công thức tổng quát este no đơn chức: CₙH₂ₙO₂ (n ≥ 2).',
      },
      { type: 'f', text: 'RCOOH + R′OH ⇌ RCOOR′ + H₂O  (xt H₂SO₄ đặc, t°)' },
      { type: 'h', text: '2. Tính chất hoá học' },
      { type: 'b', text: 'Thuỷ phân môi trường axit (thuận nghịch): RCOOR′ + H₂O ⇌ RCOOH + R′OH' },
      {
        type: 'b',
        text: 'Thuỷ phân môi trường kiềm (xà phòng hoá, 1 chiều): RCOOR′ + NaOH → RCOONa + R′OH',
      },
      { type: 'h', text: '3. Lipit — Chất béo' },
      {
        type: 'p',
        text: 'Chất béo là trieste của glixerol C₃H₅(OH)₃ với axit béo (axit stearic C₁₇H₃₅COOH, axit oleic C₁₇H₃₃COOH...). Gọi là triglixerit.',
      },
      {
        type: 'p',
        text: 'Phản ứng xà phòng hoá chất béo tạo glixerol + muối natri của axit béo (xà phòng). Chỉ số xà phòng hoá đặc trưng cho chất béo.',
      },
      { type: 'h', text: '4. Bài tập' },
      {
        type: 'p',
        text: 'Xà phòng hoá hoàn toàn 8,8g etyl axetat (CH₃COOC₂H₅, M=88) cần bao nhiêu gam NaOH? Giải: n_este = 8,8/88 = 0,1 mol ⟹ n_NaOH = 0,1 mol ⟹ m = 0,1·40 = 4g.',
      },
    ],
  },
  {
    match: 'ielts speaking',
    blocks: [
      { type: 'h', text: 'IELTS SPEAKING PART 2 — Cue Card Strategy' },
      {
        type: 'p',
        text: 'You have 1 minute to prepare and 1–2 minutes to speak. Use the bullet points on the cue card to structure your answer, but always add personal details and examples.',
      },
      { type: 'h', text: 'Topic 1: Describe a person who has influenced you' },
      {
        type: 'p',
        text: 'Sample (Band 8): "I\'d like to talk about my high school physics teacher, Mr. Nam, who had a profound impact on the way I approach problems. What struck me most was his patience — whenever a concept seemed impossible, he would break it down into tiny, digestible steps. I vividly remember struggling with electromagnetism; he stayed after class for a week, using everyday analogies until it finally clicked. Thanks to him, I developed not just an interest in science but also the resilience to tackle difficult challenges."',
      },
      { type: 'h', text: 'Topic 2: Describe a memorable trip' },
      {
        type: 'p',
        text: 'Sample (Band 8): "One trip that stands out vividly was my visit to Da Lat last summer. The moment I stepped off the bus, the crisp mountain air was a refreshing contrast to the humidity of the city. We spent the days cycling around the pine forests and the evenings sampling local street food. What made it truly unforgettable, though, was watching the sunrise over the valley — it was absolutely breathtaking and gave me a renewed appreciation for nature."',
      },
      { type: 'h', text: 'Useful high-band phrases' },
      { type: 'b', text: 'What struck me most was... / It was absolutely breathtaking' },
      { type: 'b', text: 'I vividly remember... / That stands out in my memory' },
      { type: 'b', text: 'It had a profound impact on... / I developed a genuine interest in...' },
    ],
  },
  {
    match: 'ielts writing',
    blocks: [
      { type: 'h', text: 'IELTS WRITING TASK 2 — Essay Structure (Band 7.0+)' },
      {
        type: 'p',
        text: 'Task 2 requires a 250-word essay in 40 minutes. A clear 4-paragraph structure maximises your Coherence & Cohesion score.',
      },
      { type: 'b', text: 'Introduction: paraphrase the question + state your position' },
      { type: 'b', text: 'Body 1: first main idea + explanation + example' },
      { type: 'b', text: 'Body 2: second main idea + explanation + example' },
      { type: 'b', text: 'Conclusion: restate position + summarise' },
      { type: 'h', text: 'Sample question' },
      {
        type: 'p',
        text: '"Some people believe that universities should focus on academic subjects, while others think practical skills are more important. Discuss both views and give your opinion."',
      },
      { type: 'h', text: 'Sample introduction (Band 7.5)' },
      {
        type: 'p',
        text: '"The debate over whether higher education should prioritise theoretical knowledge or vocational competence has gained considerable traction in recent years. While academic disciplines undeniably cultivate critical thinking, I would argue that integrating practical skills is essential for preparing graduates for the modern workforce."',
      },
      { type: 'h', text: 'Linking devices for Band 7+' },
      { type: 'b', text: 'Adding: Furthermore, Moreover, In addition' },
      { type: 'b', text: 'Contrast: However, Nevertheless, On the other hand' },
      { type: 'b', text: 'Result: Consequently, As a result, Therefore' },
      { type: 'b', text: 'Concluding: In conclusion, To sum up, Ultimately' },
    ],
  },
  {
    match: 'toeic',
    blocks: [
      { type: 'h', text: 'TOEIC READING PART 5 — Incomplete Sentences' },
      {
        type: 'p',
        text: 'Part 5 tests grammar and vocabulary. Read the sentence and choose the word that best completes it. Below are common question types with explanations.',
      },
      { type: 'h', text: 'Word form questions' },
      {
        type: 'p',
        text: 'Q: The new policy will have a significant ____ on productivity. (A) impact (B) impactful (C) impacted (D) impactfully. Answer: (A) impact — a noun is needed after the adjective "significant".',
      },
      { type: 'h', text: 'Verb tense questions' },
      {
        type: 'p',
        text: 'Q: By the time the manager arrived, the meeting ____ already. (A) starts (B) has started (C) had started (D) starting. Answer: (C) had started — past perfect for an action completed before another past action.',
      },
      { type: 'h', text: 'Preposition questions' },
      {
        type: 'p',
        text: 'Q: The report must be submitted ____ Friday. (A) in (B) on (C) at (D) by. Answer: (D) by — "by" indicates a deadline.',
      },
      { type: 'h', text: 'Tips' },
      { type: 'b', text: 'Identify the part of speech needed from the blank position.' },
      { type: 'b', text: 'Watch for time markers (already, by, since) signalling tense.' },
      { type: 'b', text: 'Eliminate options that do not collocate with surrounding words.' },
    ],
  },
  {
    match: 'jlpt n5',
    blocks: [
      { type: 'h', text: 'JLPT N5 — Kanji thông dụng' },
      {
        type: 'p',
        text: 'N5 yêu cầu khoảng 100 chữ Kanji cơ bản. Dưới đây là các chữ thường gặp kèm âm đọc và nghĩa.',
      },
      { type: 'h', text: 'Số đếm' },
      { type: 'b', text: '一 (ichi) = một    二 (ni) = hai    三 (san) = ba' },
      { type: 'b', text: '四 (shi/yon) = bốn    五 (go) = năm    十 (juu) = mười' },
      { type: 'h', text: 'Thời gian' },
      { type: 'b', text: '日 (nichi/hi) = ngày, mặt trời    月 (getsu/tsuki) = tháng, mặt trăng' },
      { type: 'b', text: '年 (nen/toshi) = năm    時 (ji) = giờ    今 (ima) = bây giờ' },
      { type: 'h', text: 'Người và gia đình' },
      { type: 'b', text: '人 (hito/jin) = người    男 (otoko) = nam    女 (onna) = nữ' },
      { type: 'b', text: '子 (ko) = con    父 (chichi) = bố    母 (haha) = mẹ' },
      { type: 'h', text: 'Động từ thường gặp' },
      { type: 'b', text: '行 (i-ku) = đi    来 (ku-ru) = đến    見 (mi-ru) = nhìn' },
      { type: 'b', text: '食 (ta-beru) = ăn    飲 (no-mu) = uống    話 (hana-su) = nói' },
    ],
  },
  {
    match: 'python',
    blocks: [
      { type: 'h', text: '1. Biến và kiểu dữ liệu' },
      {
        type: 'p',
        text: 'Python là ngôn ngữ định kiểu động. Không cần khai báo kiểu, gán trực tiếp:',
      },
      {
        type: 'code',
        text: 'name = "An"          # str\nage = 20             # int\nheight = 1.75        # float\nis_student = True    # bool',
      },
      { type: 'h', text: '2. Cấu trúc điều kiện' },
      {
        type: 'code',
        text: 'score = 85\nif score >= 80:\n    print("Giỏi")\nelif score >= 50:\n    print("Đạt")\nelse:\n    print("Chưa đạt")',
      },
      { type: 'h', text: '3. Vòng lặp' },
      {
        type: 'code',
        text: '# Tính tổng 1..100\ntotal = 0\nfor i in range(1, 101):\n    total += i\nprint(total)   # 5050',
      },
      { type: 'h', text: '4. Hàm' },
      {
        type: 'code',
        text: 'def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\nprint(factorial(5))   # 120',
      },
      { type: 'h', text: '5. List và list comprehension' },
      {
        type: 'code',
        text: 'nums = [1, 2, 3, 4, 5]\nsquares = [x**2 for x in nums]\nevens = [x for x in nums if x % 2 == 0]\nprint(squares)  # [1, 4, 9, 16, 25]\nprint(evens)    # [2, 4]',
      },
      { type: 'h', text: '6. Bài thực hành' },
      { type: 'b', text: 'Viết hàm kiểm tra số nguyên tố.' },
      { type: 'b', text: 'Đếm số lần xuất hiện mỗi ký tự trong chuỗi (dùng dict).' },
      { type: 'b', text: 'Đảo ngược một danh sách không dùng reverse().' },
    ],
  },
  {
    match: 'javascript es6',
    blocks: [
      { type: 'h', text: '1. let, const và arrow function' },
      {
        type: 'code',
        text: 'const PI = 3.14159;        // không gán lại\nlet count = 0;             // block-scoped\nconst square = x => x * x; // arrow function\nconsole.log(square(5));    // 25',
      },
      { type: 'h', text: '2. Template literals' },
      {
        type: 'code',
        text: "const name = 'An';\nconst age = 20;\nconsole.log(`Tôi là ${name}, ${age} tuổi.`);",
      },
      { type: 'h', text: '3. Destructuring' },
      {
        type: 'code',
        text: "const user = { id: 1, name: 'An', role: 'admin' };\nconst { name, role } = user;\nconst [first, second] = [10, 20];",
      },
      { type: 'h', text: '4. Spread & rest' },
      {
        type: 'code',
        text: 'const arr1 = [1, 2];\nconst arr2 = [...arr1, 3, 4];   // [1,2,3,4]\nconst sum = (...nums) => nums.reduce((a, b) => a + b, 0);\nsum(1, 2, 3);                  // 6',
      },
      { type: 'h', text: '5. Promise & async/await' },
      {
        type: 'code',
        text: "async function getData() {\n  try {\n    const res = await fetch('/api/data');\n    const json = await res.json();\n    return json;\n  } catch (err) {\n    console.error(err);\n  }\n}",
      },
      { type: 'h', text: '6. Array methods quan trọng' },
      { type: 'b', text: 'map() — biến đổi từng phần tử, trả mảng mới' },
      { type: 'b', text: 'filter() — lọc phần tử thoả điều kiện' },
      { type: 'b', text: 'reduce() — gộp mảng thành 1 giá trị' },
    ],
  },
  {
    match: 'tieng anh giao tiep',
    blocks: [
      { type: 'h', text: 'Tiếng Anh giao tiếp công sở' },
      {
        type: 'p',
        text: 'Tổng hợp mẫu câu thông dụng trong môi trường công sở theo từng tình huống.',
      },
      { type: 'h', text: '1. Chào hỏi & giới thiệu' },
      { type: 'b', text: "Nice to meet you. I'm Nam from the Marketing team." },
      { type: 'b', text: 'Let me introduce my colleague, Ms. Lan.' },
      { type: 'h', text: '2. Họp hành' },
      { type: 'b', text: "Shall we get started? / Let's begin with the first item on the agenda." },
      { type: 'b', text: "Could you elaborate on that point? / I'd like to add something here." },
      { type: 'b', text: "Let's table this discussion for the next meeting." },
      { type: 'h', text: '3. Email lịch sự' },
      { type: 'b', text: 'I am writing to follow up on... / Please find attached...' },
      { type: 'b', text: 'I would appreciate it if you could... / Looking forward to your reply.' },
      { type: 'h', text: '4. Điện thoại' },
      { type: 'b', text: 'Could I speak to Mr. Hung, please? / May I take a message?' },
      { type: 'b', text: "I'm calling regarding... / Let me put you through to..." },
    ],
  },
  {
    match: 'vo chong a phu',
    blocks: [
      { type: 'h', text: 'Phân tích "Vợ chồng A Phủ" — Tô Hoài' },
      { type: 'h', text: '1. Tác giả & hoàn cảnh sáng tác' },
      {
        type: 'p',
        text: 'Tô Hoài là cây bút văn xuôi tiêu biểu của văn học hiện đại Việt Nam. "Vợ chồng A Phủ" (1952) in trong tập "Truyện Tây Bắc", là kết quả chuyến đi thực tế cùng bộ đội giải phóng Tây Bắc.',
      },
      { type: 'h', text: '2. Nhân vật Mị' },
      {
        type: 'p',
        text: 'Mị là cô gái Mèo trẻ đẹp, tài hoa nhưng bị bắt làm con dâu gạt nợ nhà thống lí Pá Tra. Từ cô gái yêu đời, Mị trở nên câm lặng, "lùi lũi như con rùa nuôi trong xó cửa". Tuy nhiên sức sống tiềm tàng vẫn âm ỉ: đêm tình mùa xuân, tiếng sáo gọi bạn đánh thức khát vọng tự do; đêm cứu A Phủ là sự trỗi dậy mạnh mẽ của ý thức phản kháng.',
      },
      { type: 'h', text: '3. Nhân vật A Phủ' },
      {
        type: 'p',
        text: 'A Phủ là chàng trai mồ côi, gan góc, lao động giỏi. Vì đánh con quan mà bị phạt vạ, trở thành người ở trừ nợ. Khi để hổ ăn mất bò, A Phủ bị trói đứng chờ chết — chi tiết tố cáo sự tàn bạo của chế độ phong kiến miền núi.',
      },
      { type: 'h', text: '4. Giá trị tác phẩm' },
      {
        type: 'b',
        text: 'Giá trị hiện thực: phơi bày số phận bi thảm của người dân lao động dưới ách thống trị.',
      },
      {
        type: 'b',
        text: 'Giá trị nhân đạo: phát hiện và trân trọng sức sống, khát vọng tự do tiềm tàng.',
      },
      {
        type: 'b',
        text: 'Nghệ thuật: miêu tả tâm lí tinh tế, ngôn ngữ giàu chất thơ, đậm màu sắc Tây Bắc.',
      },
    ],
  },
  {
    match: 'nghi luan xa hoi',
    blocks: [
      { type: 'h', text: 'Nghị luận xã hội — Dàn ý chuẩn' },
      {
        type: 'p',
        text: 'Bài NLXH thường có 2 dạng: nghị luận về tư tưởng đạo lí và nghị luận về hiện tượng đời sống. Dưới đây là dàn ý tổng quát.',
      },
      { type: 'h', text: '1. Mở bài' },
      {
        type: 'p',
        text: 'Dẫn dắt và nêu vấn đề cần nghị luận. Có thể dùng câu danh ngôn, câu hỏi gợi mở hoặc tình huống thực tế.',
      },
      { type: 'h', text: '2. Thân bài' },
      { type: 'b', text: 'Giải thích: làm rõ khái niệm, từ khoá của vấn đề.' },
      {
        type: 'b',
        text: 'Bàn luận: phân tích biểu hiện, nguyên nhân, ý nghĩa/tác hại; dẫn chứng thực tế.',
      },
      { type: 'b', text: 'Mở rộng & phản biện: nhìn vấn đề đa chiều, phê phán mặt trái.' },
      { type: 'b', text: 'Bài học nhận thức và hành động: rút ra liên hệ bản thân.' },
      { type: 'h', text: '3. Kết bài' },
      { type: 'p', text: 'Khẳng định lại vấn đề và nêu thông điệp/lời kêu gọi.' },
      { type: 'h', text: 'Ví dụ đề: "Lòng biết ơn"' },
      {
        type: 'p',
        text: 'Giải thích: biết ơn là sự ghi nhớ, trân trọng những gì người khác mang lại cho mình. Bàn luận: lòng biết ơn là nền tảng đạo đức, gắn kết con người (dẫn chứng "Uống nước nhớ nguồn", ngày 20/11, 27/7). Phản biện: phê phán thói vô ơn, sống ích kỷ. Bài học: thể hiện biết ơn bằng hành động cụ thể.',
      },
    ],
  },
];

export function findContent(title: string): DocContent | null {
  const norm = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  return REAL_CONTENTS.find((c) => norm.includes(c.match)) ?? null;
}
