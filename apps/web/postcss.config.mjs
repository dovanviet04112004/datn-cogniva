// Cấu hình PostCSS — pipeline xử lý CSS chạy khi Next.js build.
//   1. tailwindcss     → expand các @apply / utility class thành CSS thật
//   2. autoprefixer    → tự thêm vendor prefix (-webkit-, -moz-…) cho các
//                        thuộc tính cần thiết theo browserslist
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
