# Tên miền production

Website người dùng và callback Meta dùng `https://creative-campaign-lgclinic.vercel.app`.

`vercel deploy --prod --yes` hiện chỉ tự cập nhật alias dài `creative-campaign-lgclinic-ducndna-5064s-projects.vercel.app`. Không được coi việc deploy xong là tên miền chính đã được cập nhật.

Sau mỗi lần deploy, kiểm tra `vercel alias ls`. Nếu tên miền chính chưa trỏ tới deployment vừa tạo, chạy `vercel alias set <deployment-url-vừa-tạo> creative-campaign-lgclinic.vercel.app`.

Xác minh trên tên miền chính: phiên bản script trong HTML, `/health`, `/api/auth/session` và thao tác trình duyệt liên quan tới thay đổi. Dùng đường link chính khi gửi kết quả cho người dùng.

Ngày 07/09/2026 đã cập nhật tên miền chính sang deployment `creative-campaign-lgclinic-2rdlb2gwn-ducndna-5064s-projects.vercel.app`. Trước đó tên miền còn trỏ vào bản cũ không có tự lưu. Đã kiểm tra trình duyệt trên tài khoản có phiên Meta: nhập tên bản nháp, tải lại, tên bản nháp và trạng thái kết nối vẫn còn.
