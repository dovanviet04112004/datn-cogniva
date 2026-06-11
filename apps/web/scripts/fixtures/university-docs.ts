import type { Block } from './real-doc-content';

export type UniDoc = {
  universitySlug: string;
  courseCode: string;
  courseName: string;
  subjectArea: string;
  title: string;
  docType: string;
  blocks: Block[];
};

const h = (text: string): Block => ({ type: 'h', text });
const p = (text: string): Block => ({ type: 'p', text });
const b = (text: string): Block => ({ type: 'b', text });
const f = (text: string): Block => ({ type: 'f', text });
const code = (text: string): Block => ({ type: 'code', text });

export const UNIVERSITY_DOCS: UniDoc[] = [
  {
    universitySlug: 'hust',
    courseCode: 'MI1111',
    courseName: 'Giải tích 1',
    subjectArea: 'math',
    title: 'Giải tích 1 — Giới hạn, đạo hàm & tích phân (HUST)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Giới hạn hàm số'),
      p(
        'Giới hạn là khái niệm nền tảng của giải tích. Hàm f(x) có giới hạn L khi x→a nếu với mọi ε>0 tồn tại δ>0 sao cho 0<|x−a|<δ kéo theo |f(x)−L|<ε.',
      ),
      f('lim(x→0) sin x / x = 1     lim(x→∞) (1 + 1/x)ˣ = e'),
      h('2. Hàm liên tục'),
      p(
        'Hàm f liên tục tại a nếu lim(x→a) f(x) = f(a). Định lý giá trị trung gian (Bolzano): nếu f liên tục trên [a,b] và f(a)·f(b)<0 thì tồn tại c∈(a,b) với f(c)=0 — cơ sở phương pháp chia đôi tìm nghiệm.',
      ),
      h('3. Đạo hàm và vi phân'),
      f("f'(x) = lim(h→0) [f(x+h)−f(x)]/h     df = f'(x)dx"),
      p(
        "Định lý Lagrange (giá trị trung bình): tồn tại c∈(a,b) sao cho f(b)−f(a) = f′(c)(b−a). Quy tắc L'Hôpital cho dạng 0/0 hoặc ∞/∞: lim f/g = lim f′/g′.",
      ),
      h('4. Khai triển Taylor'),
      f('f(x) = f(a) + f′(a)(x−a) + f″(a)(x−a)²/2! + … + fⁿ(a)(x−a)ⁿ/n! + Rₙ'),
      p(
        'Khai triển Maclaurin (a=0) các hàm cơ bản: eˣ = 1 + x + x²/2! + …; sin x = x − x³/3! + x⁵/5! − …; ln(1+x) = x − x²/2 + x³/3 − …',
      ),
      h('5. Tích phân suy rộng'),
      p(
        'Tích phân ∫ₐ^∞ f(x)dx = lim(b→∞) ∫ₐᵇ f(x)dx. Hội tụ khi giới hạn hữu hạn. Tiêu chuẩn so sánh: nếu 0≤f≤g và ∫g hội tụ thì ∫f hội tụ.',
      ),
      h('6. Bài tập'),
      b("Tính lim(x→0) (eˣ−1)/x. ĐS: 1 (dùng Taylor hoặc L'Hôpital)."),
      b('Khai triển Taylor cos x đến bậc 4. ĐS: 1 − x²/2 + x⁴/24.'),
      b('Xét hội tụ ∫₁^∞ 1/x² dx. ĐS: hội tụ, bằng 1.'),
    ],
  },
  {
    universitySlug: 'hust',
    courseCode: 'MI1141',
    courseName: 'Đại số tuyến tính',
    subjectArea: 'math',
    title: 'Đại số tuyến tính — Ma trận, định thức & không gian vectơ (HUST)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Ma trận và phép toán'),
      p(
        'Ma trận cỡ m×n là bảng số m hàng n cột. Phép nhân ma trận A(m×n)·B(n×p) = C(m×p) với cᵢⱼ = Σ aᵢₖbₖⱼ. Nhân ma trận không giao hoán: AB ≠ BA nói chung.',
      ),
      h('2. Định thức'),
      f('det(2×2) = ad − bc     det(AB) = det(A)·det(B)'),
      p(
        'Định thức cấp n tính bằng khai triển Laplace theo hàng/cột. Ma trận khả nghịch ⟺ det ≠ 0. Khi đó A⁻¹ = (1/det A)·adj(A).',
      ),
      h('3. Hệ phương trình tuyến tính'),
      p(
        'Hệ Ax = b. Phương pháp khử Gauss đưa ma trận về dạng bậc thang. Định lý Cramer: nếu det A ≠ 0, nghiệm xᵢ = det(Aᵢ)/det(A) với Aᵢ là A thay cột i bằng b.',
      ),
      h('4. Không gian vectơ'),
      p(
        'Tập V với phép cộng và nhân vô hướng thoả 8 tiên đề. Cơ sở là hệ vectơ độc lập tuyến tính sinh ra V. Số vectơ cơ sở = số chiều dim(V). Hạng ma trận rank(A) = số chiều không gian dòng.',
      ),
      h('5. Trị riêng & vectơ riêng'),
      f('Av = λv  ⟺  det(A − λI) = 0  (phương trình đặc trưng)'),
      p(
        'Trị riêng λ là nghiệm phương trình đặc trưng; vectơ riêng v ≠ 0 thoả Av = λv. Ứng dụng: chéo hoá ma trận A = PDP⁻¹, tính lũy thừa Aⁿ, hệ động lực học.',
      ),
      h('6. Bài tập'),
      b('Tính định thức ma trận [[1,2],[3,4]]. ĐS: 1·4 − 2·3 = −2.'),
      b('Tìm trị riêng của [[2,0],[0,3]]. ĐS: λ = 2 và λ = 3.'),
    ],
  },
  {
    universitySlug: 'hust',
    courseCode: 'ET2060',
    courseName: 'Hệ thống nhúng',
    subjectArea: 'cs-programming',
    title: 'Hệ thống nhúng — Vi điều khiển & lập trình thời gian thực (HUST)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Tổng quan hệ thống nhúng'),
      p(
        'Hệ thống nhúng (embedded system) là hệ máy tính chuyên dụng tích hợp trong thiết bị, thực hiện một số tác vụ cố định với ràng buộc về thời gian, công suất, bộ nhớ. Ví dụ: ECU ô tô, máy giặt, thiết bị IoT, drone.',
      ),
      b(
        'Đặc trưng: tài nguyên hạn chế (RAM/Flash nhỏ), real-time, độ tin cậy cao, tiêu thụ điện thấp.',
      ),
      h('2. Kiến trúc vi điều khiển'),
      p(
        'MCU (Microcontroller Unit) tích hợp CPU + RAM + Flash + ngoại vi (GPIO, UART, SPI, I2C, ADC, Timer) trên một chip. Phổ biến: ARM Cortex-M (STM32), AVR (Arduino), ESP32.',
      ),
      b('GPIO: chân vào/ra số, cấu hình input/output, đọc nút nhấn, điều khiển LED.'),
      b('Timer/PWM: tạo xung, điều khiển động cơ servo, băm xung điều chỉnh độ sáng.'),
      b('ADC: chuyển đổi tín hiệu analog (cảm biến) sang số.'),
      h('3. Giao tiếp ngoại vi'),
      f(
        'UART: bất đồng bộ, 2 dây TX/RX     I2C: 2 dây SDA/SCL, đa thiết bị     SPI: 4 dây, tốc độ cao',
      ),
      h('4. Lập trình nhúng C'),
      code(
        '// Bật/tắt LED trên STM32 (HAL)\nwhile (1) {\n  HAL_GPIO_TogglePin(GPIOA, GPIO_PIN_5);\n  HAL_Delay(500);  // 500ms\n}',
      ),
      h('5. Hệ điều hành thời gian thực (RTOS)'),
      p(
        'RTOS (FreeRTOS) quản lý đa nhiệm với scheduler ưu tiên. Khái niệm: task, semaphore, queue, mutex. Hard real-time đảm bảo deadline tuyệt đối; soft real-time cho phép trễ nhỏ.',
      ),
      code(
        '// FreeRTOS task\nvoid vBlinkTask(void *pv) {\n  for (;;) {\n    toggle_led();\n    vTaskDelay(pdMS_TO_TICKS(500));\n  }\n}',
      ),
      h('6. Bài tập'),
      b('Cấu hình Timer tạo PWM tần số 1kHz duty 50%.'),
      b('Đọc cảm biến nhiệt độ qua I2C và gửi qua UART.'),
    ],
  },
  {
    universitySlug: 'hust',
    courseCode: 'IT3011',
    courseName: 'Cấu trúc dữ liệu & Giải thuật',
    subjectArea: 'cs-algorithms',
    title: 'Cấu trúc dữ liệu & Giải thuật — Tổng hợp (HUST)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Độ phức tạp thuật toán'),
      p(
        'Ký hiệu Big-O mô tả cận trên tốc độ tăng thời gian chạy theo kích thước input n. O(1) hằng số, O(log n) nhị phân, O(n) tuyến tính, O(n log n) sắp xếp tốt, O(n²) lồng, O(2ⁿ) mũ.',
      ),
      h('2. Cấu trúc dữ liệu cơ bản'),
      b('Mảng (array): truy cập O(1), chèn/xoá O(n).'),
      b('Danh sách liên kết: chèn/xoá O(1) khi biết vị trí, truy cập O(n).'),
      b('Ngăn xếp (stack) LIFO, hàng đợi (queue) FIFO.'),
      b('Cây nhị phân tìm kiếm (BST): tìm/chèn/xoá O(log n) trung bình.'),
      b('Bảng băm (hash table): truy cập trung bình O(1).'),
      h('3. Thuật toán sắp xếp'),
      f('QuickSort O(n log n) trung bình · MergeSort O(n log n) ổn định · HeapSort O(n log n)'),
      code(
        'def quicksort(a):\n    if len(a) <= 1: return a\n    pivot = a[len(a)//2]\n    left  = [x for x in a if x < pivot]\n    mid   = [x for x in a if x == pivot]\n    right = [x for x in a if x > pivot]\n    return quicksort(left) + mid + quicksort(right)',
      ),
      h('4. Thuật toán đồ thị'),
      b('BFS (duyệt rộng) — tìm đường ngắn nhất đồ thị không trọng số.'),
      b('DFS (duyệt sâu) — phát hiện chu trình, sắp xếp topo.'),
      b('Dijkstra — đường ngắn nhất đồ thị trọng số không âm, O((V+E)log V).'),
      h('5. Quy hoạch động'),
      p(
        'Chia bài toán thành bài toán con gối nhau, lưu kết quả (memoization). Ví dụ Fibonacci, knapsack, dãy con chung dài nhất (LCS).',
      ),
      code(
        '# Fibonacci DP O(n)\ndef fib(n):\n    dp = [0, 1]\n    for i in range(2, n+1):\n        dp.append(dp[i-1] + dp[i-2])\n    return dp[n]',
      ),
    ],
  },
  {
    universitySlug: 'vnu-uet',
    courseCode: 'INT2208',
    courseName: 'Mạng máy tính',
    subjectArea: 'cs-basics',
    title: 'Mạng máy tính — Mô hình TCP/IP & định tuyến (UET)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Mô hình phân tầng'),
      p(
        'Mô hình OSI 7 tầng và TCP/IP 4 tầng. TCP/IP: Application (HTTP, DNS), Transport (TCP, UDP), Internet (IP), Network Access (Ethernet). Mỗi tầng đóng gói dữ liệu của tầng trên (encapsulation).',
      ),
      h('2. Tầng giao vận'),
      b(
        'TCP: tin cậy, có kết nối, 3-way handshake (SYN, SYN-ACK, ACK), kiểm soát luồng + tắc nghẽn.',
      ),
      b('UDP: không kết nối, nhanh, không đảm bảo — dùng cho streaming, DNS, game.'),
      h('3. Địa chỉ IP và subnet'),
      f('IPv4: 32 bit, vd 192.168.1.10/24 → network 192.168.1.0, host 1–254'),
      p(
        'Subnet mask /24 = 255.255.255.0 chia mạng con. CIDR cho phép chia linh hoạt. IPv6 dùng 128 bit giải quyết cạn kiệt địa chỉ.',
      ),
      h('4. Định tuyến'),
      p(
        'Router chuyển gói giữa các mạng dựa bảng định tuyến. Giao thức: RIP (distance vector), OSPF (link state), BGP (giữa các AS trên Internet).',
      ),
      h('5. DNS & HTTP'),
      p(
        'DNS phân giải tên miền → IP (phân cấp: root → TLD → authoritative). HTTP/HTTPS tầng ứng dụng, request/response; HTTPS mã hoá qua TLS.',
      ),
      h('6. Bài tập'),
      b('Một mạng /26 có bao nhiêu host khả dụng? ĐS: 2⁶−2 = 62.'),
      b('Phân biệt TCP và UDP qua ví dụ ứng dụng cụ thể.'),
    ],
  },
  {
    universitySlug: 'vnu-uet',
    courseCode: 'INT2210',
    courseName: 'Hệ điều hành',
    subjectArea: 'cs-basics',
    title: 'Hệ điều hành — Tiến trình, bộ nhớ & quản lý tài nguyên (UET)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Khái niệm hệ điều hành'),
      p(
        'Hệ điều hành (OS) quản lý tài nguyên phần cứng và cung cấp giao diện cho ứng dụng. Chức năng: quản lý tiến trình, bộ nhớ, file, thiết bị I/O.',
      ),
      h('2. Tiến trình và luồng'),
      b('Tiến trình (process): chương trình đang chạy, có không gian địa chỉ riêng.'),
      b('Luồng (thread): đơn vị thực thi trong tiến trình, chia sẻ bộ nhớ.'),
      b('Trạng thái: New → Ready → Running → Waiting → Terminated.'),
      h('3. Lập lịch CPU'),
      p(
        'Thuật toán: FCFS (đến trước phục vụ trước), SJF (ngắn nhất trước), Round Robin (quay vòng quantum), Priority. Tiêu chí: throughput, turnaround time, waiting time.',
      ),
      h('4. Đồng bộ hoá'),
      p(
        'Vấn đề tranh chấp tài nguyên (race condition). Giải pháp: mutex, semaphore, monitor. Deadlock xảy ra khi 4 điều kiện Coffman đồng thời: loại trừ, giữ và chờ, không trưng dụng, chờ vòng.',
      ),
      h('5. Quản lý bộ nhớ'),
      p(
        'Phân trang (paging) chia bộ nhớ thành frame/page cố định. Bộ nhớ ảo (virtual memory) cho phép chạy chương trình lớn hơn RAM, dùng swap. Thuật toán thay trang: FIFO, LRU, Optimal.',
      ),
      h('6. Bài tập'),
      b('Tính waiting time trung bình với Round Robin quantum=2.'),
      b('Mô phỏng thay trang LRU với chuỗi tham chiếu cho trước.'),
    ],
  },
  {
    universitySlug: 'vnu-uet',
    courseCode: 'INT3115',
    courseName: 'Trí tuệ nhân tạo',
    subjectArea: 'cs-ai-ml',
    title: 'Trí tuệ nhân tạo — Tìm kiếm, học máy & mạng nơ-ron (UET)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Tổng quan AI'),
      p(
        'AI nghiên cứu xây dựng hệ thống thực hiện tác vụ đòi hỏi trí tuệ: suy luận, học, nhận thức, ra quyết định. Phân nhánh: tìm kiếm, biểu diễn tri thức, học máy, xử lý ngôn ngữ, thị giác.',
      ),
      h('2. Thuật toán tìm kiếm'),
      b('Tìm kiếm mù: BFS, DFS, UCS.'),
      b('Tìm kiếm có thông tin: Greedy, A* với hàm f(n) = g(n) + h(n), heuristic admissible.'),
      h('3. Học máy cơ bản'),
      p(
        'Học có giám sát (phân loại, hồi quy), học không giám sát (phân cụm), học tăng cường. Quy trình: thu thập dữ liệu → tiền xử lý → huấn luyện → đánh giá (accuracy, precision, recall, F1).',
      ),
      f('Hồi quy tuyến tính: ŷ = wx + b, tối thiểu MSE = (1/n)Σ(yᵢ − ŷᵢ)²'),
      h('4. Mạng nơ-ron'),
      p(
        'Perceptron: tổng có trọng số qua hàm kích hoạt (sigmoid, ReLU). Mạng nhiều lớp huấn luyện bằng lan truyền ngược (backpropagation) + gradient descent. Deep learning dùng mạng nhiều tầng (CNN cho ảnh, RNN/Transformer cho chuỗi).',
      ),
      code('# Gradient descent 1 bước\nw = w - lr * dL_dw\nb = b - lr * dL_db'),
      h('5. Bài tập'),
      b('Áp dụng A* tìm đường trên lưới với heuristic Manhattan.'),
      b('Tính F1-score khi precision=0.8, recall=0.6. ĐS: 2·0.8·0.6/(0.8+0.6) ≈ 0.686.'),
    ],
  },
  {
    universitySlug: 'neu',
    courseCode: 'KTVM1101',
    courseName: 'Kinh tế vi mô',
    subjectArea: 'social',
    title: 'Kinh tế vi mô — Cung cầu, độ co giãn & thị trường (NEU)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Cung và cầu'),
      p(
        'Cầu là lượng hàng người mua muốn và có khả năng mua ở các mức giá. Luật cầu: giá tăng → lượng cầu giảm (đường cầu dốc xuống). Luật cung: giá tăng → lượng cung tăng (đường cung dốc lên).',
      ),
      h('2. Cân bằng thị trường'),
      f('Cân bằng: Qd = Qs  → giá cân bằng P* và lượng cân bằng Q*'),
      p(
        'Dư cung (giá > P*) gây áp lực giảm giá; dư cầu (giá < P*) gây áp lực tăng giá. Thị trường tự điều chỉnh về cân bằng.',
      ),
      h('3. Độ co giãn'),
      f('Co giãn cầu theo giá: Ed = (%ΔQ)/(%ΔP)'),
      b('|Ed| > 1: co giãn (xa xỉ phẩm) — giảm giá tăng doanh thu.'),
      b('|Ed| < 1: kém co giãn (thiết yếu) — tăng giá tăng doanh thu.'),
      h('4. Lý thuyết hành vi người tiêu dùng'),
      p(
        'Người tiêu dùng tối đa hoá hữu dụng (utility) trong giới hạn ngân sách. Quy luật hữu dụng cận biên giảm dần. Cân bằng tiêu dùng: MUₓ/Pₓ = MUᵧ/Pᵧ.',
      ),
      h('5. Cấu trúc thị trường'),
      b('Cạnh tranh hoàn hảo: nhiều người bán, sản phẩm đồng nhất, P = MC.'),
      b('Độc quyền: một người bán, đặt giá P > MC, gây mất không (deadweight loss).'),
      b('Cạnh tranh độc quyền & độc quyền nhóm (oligopoly).'),
      h('6. Bài tập'),
      b('Cho Qd = 100 − 2P, Qs = 20 + 2P. Tìm cân bằng. ĐS: P*=20, Q*=60.'),
    ],
  },
  {
    universitySlug: 'neu',
    courseCode: 'KTVM1102',
    courseName: 'Kinh tế vĩ mô',
    subjectArea: 'social',
    title: 'Kinh tế vĩ mô — GDP, lạm phát & chính sách (NEU)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Đo lường sản lượng quốc gia'),
      f('GDP = C + I + G + (X − M)'),
      p(
        'GDP là tổng giá trị thị trường hàng hoá dịch vụ cuối cùng sản xuất trong lãnh thổ một thời kỳ. GDP danh nghĩa tính theo giá hiện hành; GDP thực tính theo giá cố định (loại lạm phát).',
      ),
      h('2. Lạm phát'),
      p(
        'Lạm phát là sự tăng mức giá chung. Đo bằng CPI (chỉ số giá tiêu dùng). Nguyên nhân: cầu kéo (cầu vượt cung) và chi phí đẩy (chi phí sản xuất tăng).',
      ),
      f('Tỷ lệ lạm phát = (CPIₜ − CPIₜ₋₁)/CPIₜ₋₁ × 100%'),
      h('3. Thất nghiệp'),
      b('Thất nghiệp tự nhiên: cọ xát + cơ cấu.'),
      b('Thất nghiệp chu kỳ: do suy thoái kinh tế.'),
      p('Đường Phillips mô tả đánh đổi ngắn hạn giữa lạm phát và thất nghiệp.'),
      h('4. Chính sách tài khoá'),
      p(
        'Chính phủ dùng chi tiêu G và thuế T điều tiết nền kinh tế. Mở rộng (tăng G, giảm T) kích cầu khi suy thoái; thắt chặt khi lạm phát cao. Số nhân chi tiêu k = 1/(1−MPC).',
      ),
      h('5. Chính sách tiền tệ'),
      p(
        'Ngân hàng trung ương điều chỉnh cung tiền qua lãi suất, nghiệp vụ thị trường mở, tỷ lệ dự trữ bắt buộc. Giảm lãi suất → kích thích đầu tư, tiêu dùng.',
      ),
    ],
  },
  {
    universitySlug: 'neu',
    courseCode: 'KETO1101',
    courseName: 'Nguyên lý kế toán',
    subjectArea: 'social',
    title: 'Nguyên lý kế toán — Phương trình kế toán & ghi sổ kép (NEU)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Phương trình kế toán cơ bản'),
      f('Tài sản = Nợ phải trả + Vốn chủ sở hữu'),
      p(
        'Mọi nghiệp vụ kinh tế đều giữ cân bằng phương trình này. Tài sản là nguồn lực doanh nghiệp kiểm soát; nợ phải trả là nghĩa vụ; vốn chủ sở hữu là phần còn lại thuộc chủ.',
      ),
      h('2. Tài khoản và ghi sổ kép'),
      p(
        'Mỗi nghiệp vụ ghi vào ít nhất 2 tài khoản: Nợ (Debit) và Có (Credit), tổng Nợ = tổng Có. Tài sản & chi phí tăng ghi Nợ; nợ phải trả, vốn & doanh thu tăng ghi Có.',
      ),
      h('3. Ví dụ định khoản'),
      b('Mua hàng 10 triệu trả tiền mặt: Nợ Hàng tồn kho 10tr / Có Tiền mặt 10tr.'),
      b('Vay ngân hàng 50 triệu: Nợ Tiền gửi NH 50tr / Có Vay 50tr.'),
      h('4. Báo cáo tài chính'),
      b('Bảng cân đối kế toán: ảnh chụp tài sản − nguồn vốn tại một thời điểm.'),
      b('Báo cáo kết quả kinh doanh: doanh thu − chi phí = lợi nhuận trong kỳ.'),
      b('Báo cáo lưu chuyển tiền tệ: dòng tiền hoạt động/đầu tư/tài chính.'),
      h('5. Bài tập'),
      b('Doanh nghiệp có TS 800tr, nợ 300tr. Tính vốn chủ. ĐS: 500tr.'),
    ],
  },
  {
    universitySlug: 'ftu',
    courseCode: 'KTE301',
    courseName: 'Kinh tế quốc tế',
    subjectArea: 'social',
    title: 'Kinh tế quốc tế — Lợi thế so sánh & thương mại (FTU)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Lý thuyết lợi thế tuyệt đối (Adam Smith)'),
      p(
        'Mỗi quốc gia nên chuyên môn hoá sản xuất hàng hoá mình làm hiệu quả hơn (chi phí thấp hơn) rồi trao đổi — cả hai cùng lợi.',
      ),
      h('2. Lợi thế so sánh (David Ricardo)'),
      p(
        'Ngay cả khi một nước kém hiệu quả ở mọi mặt hàng, thương mại vẫn có lợi nếu mỗi nước chuyên môn hoá vào hàng có chi phí cơ hội thấp nhất.',
      ),
      f('Chi phí cơ hội = lượng hàng B phải hy sinh để sản xuất thêm 1 đơn vị hàng A'),
      h('3. Thuế quan và hàng rào thương mại'),
      b('Thuế quan (tariff): thuế đánh vào hàng nhập khẩu → tăng giá, giảm nhập.'),
      b('Hạn ngạch (quota): giới hạn lượng nhập.'),
      b('Hàng rào kỹ thuật (TBT, SPS): tiêu chuẩn chất lượng, an toàn.'),
      h('4. Tỷ giá hối đoái'),
      p(
        'Tỷ giá là giá đồng tiền này tính theo đồng tiền khác. Tỷ giá tăng (nội tệ mất giá) → xuất khẩu rẻ hơn, nhập khẩu đắt hơn. Cán cân thanh toán ghi nhận giao dịch quốc tế.',
      ),
      h('5. Hội nhập kinh tế'),
      p(
        'Các cấp độ: khu vực mậu dịch tự do (FTA), liên minh thuế quan, thị trường chung, liên minh kinh tế. Việt Nam tham gia CPTPP, EVFTA, RCEP.',
      ),
    ],
  },
  {
    universitySlug: 'ump',
    courseCode: 'GP101',
    courseName: 'Giải phẫu học',
    subjectArea: 'sciences',
    title: 'Giải phẫu học — Hệ cơ quan cơ thể người (UMP)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Đại cương giải phẫu'),
      p(
        'Giải phẫu học nghiên cứu cấu trúc cơ thể. Tư thế giải phẫu chuẩn: đứng thẳng, mặt nhìn trước, hai tay buông, lòng bàn tay hướng trước. Các mặt phẳng: đứng dọc (sagittal), đứng ngang (frontal), nằm ngang (transverse).',
      ),
      h('2. Hệ xương'),
      p(
        'Cơ thể người trưởng thành có 206 xương, chia xương trục (sọ, cột sống, lồng ngực) và xương chi. Chức năng: nâng đỡ, bảo vệ, vận động, tạo máu (tuỷ đỏ), dự trữ canxi.',
      ),
      h('3. Hệ tuần hoàn'),
      p(
        'Tim 4 buồng (2 tâm nhĩ, 2 tâm thất). Vòng tuần hoàn lớn (cơ thể) và nhỏ (phổi). Động mạch mang máu đi từ tim, tĩnh mạch mang máu về tim. Van tim đảm bảo máu chảy một chiều.',
      ),
      h('4. Hệ hô hấp'),
      p(
        'Đường dẫn khí: mũi → hầu → thanh quản → khí quản → phế quản → phế nang. Trao đổi khí O₂/CO₂ tại phế nang qua khuếch tán.',
      ),
      h('5. Hệ thần kinh'),
      b('Thần kinh trung ương: não và tuỷ sống.'),
      b('Thần kinh ngoại biên: dây thần kinh sọ (12 đôi) và tuỷ sống (31 đôi).'),
      b('Nơ-ron là đơn vị chức năng, dẫn truyền xung điện qua synapse.'),
      h('6. Câu hỏi ôn tập'),
      b('Kể tên 4 buồng tim và chức năng từng buồng.'),
      b('Mô tả đường đi của không khí từ mũi đến phế nang.'),
    ],
  },
  {
    universitySlug: 'ump',
    courseCode: 'SL102',
    courseName: 'Sinh lý học',
    subjectArea: 'sciences',
    title: 'Sinh lý học — Chức năng các hệ cơ quan (UMP)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Hằng định nội môi (homeostasis)'),
      p(
        'Cơ thể duy trì môi trường trong ổn định (nhiệt độ, pH, đường huyết, áp suất thẩm thấu) qua cơ chế điều hoà ngược âm. Ví dụ: insulin/glucagon điều hoà đường huyết.',
      ),
      h('2. Sinh lý tế bào'),
      p(
        'Màng tế bào bán thấm. Vận chuyển: khuếch tán, thẩm thấu, vận chuyển chủ động (bơm Na⁺/K⁺-ATPase). Điện thế nghỉ khoảng −70mV, điện thế hoạt động khi khử cực.',
      ),
      h('3. Sinh lý tuần hoàn'),
      f('Cung lượng tim = Nhịp tim × Thể tích tâm thu'),
      p(
        'Huyết áp = cung lượng tim × sức cản ngoại biên. Huyết áp bình thường ~120/80 mmHg. Điều hoà bởi thần kinh giao cảm và hormone.',
      ),
      h('4. Sinh lý hô hấp'),
      p(
        'Hô hấp ngoài (phổi) và hô hấp trong (mô). O₂ vận chuyển bởi hemoglobin, CO₂ chủ yếu dạng bicarbonate. Trung khu hô hấp ở hành não điều hoà nhịp thở theo pCO₂.',
      ),
      h('5. Sinh lý thận'),
      p(
        'Thận lọc máu tạo nước tiểu qua 3 quá trình: lọc ở cầu thận, tái hấp thu và bài tiết ở ống thận. Điều hoà cân bằng nước−điện giải, pH máu, huyết áp (hệ RAA).',
      ),
    ],
  },
  {
    universitySlug: 'hlu',
    courseCode: 'LHP201',
    courseName: 'Luật Hiến pháp',
    subjectArea: 'civics',
    title: 'Luật Hiến pháp — Tổ chức bộ máy nhà nước (HLU)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Khái niệm Hiến pháp'),
      p(
        'Hiến pháp là luật cơ bản của nhà nước, có hiệu lực pháp lý cao nhất, quy định chế độ chính trị, quyền con người, quyền và nghĩa vụ cơ bản của công dân, tổ chức bộ máy nhà nước. Hiến pháp 2013 là bản hiện hành của Việt Nam.',
      ),
      h('2. Chế độ chính trị'),
      p(
        'Nhà nước CHXHCN Việt Nam là nhà nước pháp quyền XHCN của Nhân dân, do Nhân dân, vì Nhân dân. Quyền lực nhà nước là thống nhất, có sự phân công, phối hợp, kiểm soát giữa các cơ quan lập pháp, hành pháp, tư pháp.',
      ),
      h('3. Quyền con người, quyền công dân'),
      b('Quyền dân sự, chính trị: quyền sống, tự do ngôn luận, bầu cử.'),
      b('Quyền kinh tế, xã hội, văn hoá: lao động, học tập, sở hữu.'),
      h('4. Bộ máy nhà nước'),
      b('Quốc hội: cơ quan quyền lực nhà nước cao nhất, lập hiến và lập pháp.'),
      b('Chủ tịch nước: nguyên thủ quốc gia.'),
      b('Chính phủ: cơ quan hành chính nhà nước cao nhất.'),
      b('Toà án nhân dân & Viện kiểm sát: cơ quan tư pháp.'),
      h('5. Câu hỏi ôn tập'),
      b('Phân tích nguyên tắc tổ chức quyền lực nhà nước theo Hiến pháp 2013.'),
    ],
  },
  {
    universitySlug: 'hlu',
    courseCode: 'LDS301',
    courseName: 'Luật Dân sự',
    subjectArea: 'civics',
    title: 'Luật Dân sự — Hợp đồng & quyền sở hữu (HLU)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Đối tượng điều chỉnh'),
      p(
        'Luật Dân sự điều chỉnh quan hệ tài sản và quan hệ nhân thân trên cơ sở bình đẳng, tự do ý chí, tự chịu trách nhiệm. Bộ luật Dân sự 2015 là văn bản hiện hành.',
      ),
      h('2. Chủ thể quan hệ dân sự'),
      p(
        'Cá nhân (năng lực pháp luật từ khi sinh, năng lực hành vi đầy đủ từ 18 tuổi) và pháp nhân (tổ chức có tài sản độc lập, tự chịu trách nhiệm).',
      ),
      h('3. Quyền sở hữu'),
      b('Quyền chiếm hữu: nắm giữ, quản lý tài sản.'),
      b('Quyền sử dụng: khai thác công dụng, hưởng hoa lợi.'),
      b('Quyền định đoạt: chuyển nhượng, tặng cho, tiêu huỷ.'),
      h('4. Hợp đồng dân sự'),
      p(
        'Hợp đồng là sự thoả thuận làm phát sinh, thay đổi, chấm dứt quyền và nghĩa vụ. Điều kiện có hiệu lực: chủ thể có năng lực, tự nguyện, mục đích và nội dung không vi phạm pháp luật, đạo đức.',
      ),
      h('5. Trách nhiệm bồi thường thiệt hại'),
      p(
        'Người gây thiệt hại do lỗi phải bồi thường. Bồi thường thiệt hại ngoài hợp đồng dựa trên: có thiệt hại, hành vi trái pháp luật, mối quan hệ nhân quả, lỗi.',
      ),
    ],
  },
  {
    universitySlug: 'uit',
    courseCode: 'NT101',
    courseName: 'An toàn thông tin',
    subjectArea: 'cs-basics',
    title: 'An toàn thông tin — Mật mã & bảo mật hệ thống (UIT)',
    docType: 'lecture_notes',
    blocks: [
      h('1. Tam giác CIA'),
      b('Confidentiality (bí mật): chỉ người được phép truy cập.'),
      b('Integrity (toàn vẹn): dữ liệu không bị sửa trái phép.'),
      b('Availability (sẵn sàng): hệ thống luôn truy cập được.'),
      h('2. Mật mã đối xứng'),
      p(
        'Dùng chung một khoá cho mã hoá và giải mã (AES, DES). Nhanh, phù hợp dữ liệu lớn, nhưng cần kênh an toàn để trao đổi khoá.',
      ),
      h('3. Mật mã bất đối xứng'),
      p(
        'Cặp khoá công khai − bí mật (RSA, ECC). Mã hoá bằng khoá công khai, giải mã bằng khoá bí mật. Dùng cho trao đổi khoá, chữ ký số.',
      ),
      f('RSA: dựa vào độ khó phân tích thừa số nguyên tố của số lớn n = p·q'),
      h('4. Hàm băm & chữ ký số'),
      p(
        'Hàm băm (SHA-256) tạo chuỗi cố định từ dữ liệu, một chiều, chống va chạm. Chữ ký số = băm thông điệp rồi mã hoá bằng khoá bí mật → xác thực nguồn gốc + toàn vẹn.',
      ),
      h('5. Tấn công thường gặp'),
      b('SQL Injection, XSS, CSRF — lỗ hổng ứng dụng web.'),
      b('Man-in-the-Middle, DDoS — tấn công mạng.'),
      b('Phòng chống: input validation, HTTPS, tường lửa, cập nhật bản vá.'),
    ],
  },
];
