# Sâm Lốc Online

Web app chơi bài Sâm Lốc (miền Bắc) nhiều người qua 1 link, không cần cài app. Realtime bằng Socket.IO, tối đa 5 người/phòng.

## Cách đưa lên mạng để bạn bè truy cập được (không cần biết lập trình)

Làm 2 bước: (1) đưa code lên GitHub, (2) nối GitHub với Render để Render tự dựng link public. Cả hai đều thao tác bằng trình duyệt, không cần gõ lệnh.

### Bước 1 — Đưa code lên GitHub

1. Vào https://github.com , bấm **Sign up** tạo tài khoản miễn phí nếu chưa có (chỉ cần email).
2. Sau khi đăng nhập, bấm nút **+** góc trên phải → **New repository**.
3. Đặt tên bất kỳ, ví dụ `sam-loc-online`. Để **Public**. Bấm **Create repository**.
4. Ở trang repo vừa tạo, bấm **uploading an existing file** (hoặc **Add file → Upload files**).
5. Kéo thả **toàn bộ** các file/thư mục trong gói này vào (`server.js`, `package.json`, `samloc-engine.js`, thư mục `public/`...), giữ nguyên cấu trúc thư mục.
6. Cuộn xuống, bấm **Commit changes**.

### Bước 2 — Deploy trên Render (miễn phí, không cần thẻ)

1. Vào https://render.com , bấm **Get Started**, chọn đăng nhập bằng tài khoản **GitHub** vừa tạo (thuận tiện nhất, tự động cấp quyền đọc repo).
2. Trong dashboard Render, bấm **New +** → **Web Service**.
3. Chọn repo `sam-loc-online` vừa tạo ở Bước 1 → **Connect**.
4. Render tự nhận diện Node.js. Kiểm tra các ô:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: chọn **Free**.
5. Bấm **Create Web Service**. Đợi khoảng 1–2 phút để Render build xong (xem log chạy ở màn hình).
6. Khi thấy dòng `Sâm Lốc server chạy ở cổng ...` trong log là xong. Link public nằm ở đầu trang, dạng `https://sam-loc-online-xxxx.onrender.com`.

Gửi link đó cho bạn bè là chơi được ngay, không cần đăng nhập hay cài gì cả.

### Lưu ý về gói miễn phí của Render

- Nếu không ai mở link trong 15 phút, server sẽ "ngủ". Người tiếp theo mở link sẽ phải đợi khoảng 30–60 giây để server "tỉnh dậy" — bình thường, không phải lỗi.
- Trạng thái phòng/ván chỉ lưu tạm trong bộ nhớ server lúc đang chạy. Nếu server ngủ hoặc khởi động lại giữa ván, phòng đó sẽ mất — mở link lại và tạo phòng mới.

### Sau này muốn sửa gì đó

Sửa file trực tiếp trên GitHub (bấm vào file → biểu tượng bút chì → sửa → Commit). Render tự phát hiện thay đổi và deploy lại sau vài chục giây.

## Luật đang áp dụng (Sâm miền Bắc, theo bản "LUẬT CHƠI SÂM MIỀN BẮC v3" bạn gửi)

- Không tính chất/màu. Sức mạnh lá: 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2.
- Bộ hợp lệ: đơn, đôi, ba (xám), tứ quý, sảnh 3–9 lá liên tiếp theo dãy A-2-3-4-5-6-7-8-9-10-J-Q-K-A (A vừa thấp vừa cao, **không** được vòng K-A-2) — nhỏ nhất A-2-3, lớn nhất Q-K-A. Đủ 10 lá liên tiếp = **sảnh rồng** (chỉ tính khi báo sâm, không đánh giữa ván).
- **Người đi đầu ván:** ván 1 ngẫu nhiên; các ván sau, người thắng ván trước đi đầu (nếu ván trước là sâm bị chặn thì người chặn đi đầu). Người đi đầu được đánh **bộ bất kỳ**, không bị ép phải có lá nào cụ thể.
- **Báo sâm** (chỉ xét ngay sau khi chia bài, trước khi đánh lá nào): theo thứ tự chỗ ngồi bắt đầu từ người đi đầu — ai có sảnh rồng được báo trước tiên, luôn thắng không ai chặn được. Nếu không ai có sảnh rồng, người **đầu tiên** (theo thứ tự đó) xếp hết được 10 lá thành các bộ hợp lệ sẽ là người báo sâm **duy nhất** — không có chuyện nhiều người tranh nhau báo. Người đó đánh lần lượt từng bộ trong tay theo đúng thứ tự (nếu có đúng 1 lá 2 lẻ thì phải đánh lá đó đầu tiên); nếu ở bộ nào có người khác cầm bộ đủ sức chặn (đúng luật đè bài/chặt bài ở dưới) thì sâm bị chặn ngay tại đó — ván dừng, người chặn xem như thắng ván và đi đầu ván sau.
  - Sâm thành công: mỗi người còn lại trả **20 × mức cược**; sâm rồng thì **40 × mức cược** (không thể bị chặn).
  - Sâm bị chặn: người báo sâm đền **một lần duy nhất 20 × mức cược × số người chơi** cho riêng người chặn (những người khác không trả/nhận gì).
- Không ai báo sâm (hoặc báo sâm không xảy ra) thì chơi như Tiến Lên: đánh đè bộ trước (cùng loại, cùng số lá, hạng cao hơn) hoặc bỏ lượt; hết vòng người đánh cuối được đi tiếp; ai hết bài trước thắng.
- **Chặt (bomb), tính tiền ngay khi xảy ra, ván vẫn tiếp tục:**
  - Lá 2 đơn lẻ trên bàn chỉ bị **tứ quý** (bất kỳ hạng nào) chặt được → người bị chặt đền ngay **20 × mức cược** cho người chặt.
  - Đôi lá 2 trên bàn chỉ bị **"hai tứ quý"** (đánh 8 lá = 2 bộ tứ quý khác hạng cùng lúc) chặt được → đền ngay **20 × mức cược** *(mức tiền này tài liệu gốc ghi là đề xuất, chưa chốt chính thức — báo lại nếu bạn muốn đổi)*.
  - Tứ quý bị tứ quý hạng cao hơn đè → đền ngay **40 × mức cược**.
  - Ba lá 2 và tứ quý 2 thì không có gì chặt được nữa.
  - "Hai tứ quý" hiện chỉ được đánh để chặt đôi lá 2 (không dùng để mở ván/đi bài chủ động), và bản thân nó không bị gì đè lại được — đây cũng là điểm tài liệu gốc ghi "chưa chốt", có thể chỉnh nếu bạn muốn cho phép đánh chủ động.
- **Cấm về bằng lá 2:** không được đánh bộ toàn lá 2 (đơn/đôi/ba/tứ quý) làm nước **cuối cùng** để hết bài. Sảnh có lá 2 ở trong (VD 2-3-4-5) vẫn đánh cuối bình thường được.
- **Tiền ván thường:** người thua trả **số lá còn lại × mức cược**; nếu còn nguyên 10 lá (chưa đánh được lá nào — gọi là **móm**) thì trả **15 × mức cược** (thay vì 10 × như bình thường).

Hai chỗ tài liệu gốc của bạn cũng ghi là "chưa chốt": số tiền chặt đôi lá 2 bằng hai tứ quý, và việc hai tứ quý có được đánh chủ động hay không. Code hiện dùng đúng phương án đề xuất trong tài liệu; chơi thử thấy cần đổi thì báo lại, mình chỉnh được ngay.
