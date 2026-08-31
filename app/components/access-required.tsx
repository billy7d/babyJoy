import { STORE_BRAND } from "../../shared/branding";

export function AccessRequiredPage() {
  return (
    <main className="access-required-page">
      <section className="access-required-card">
        <div className="access-required-mark" aria-hidden="true">
          <span>🔒</span>
        </div>
        <p className="access-required-kicker">{STORE_BRAND}</p>
        <h1>Quyền truy cập chưa sẵn sàng</h1>
        <p>
          Quyền truy cập của bạn chưa có hoặc đã hết hạn. Vui lòng mở đường dẫn
          được cung cấp trong Facebook Group để tiếp tục truy cập metraphuong.com.
        </p>
        <a className="btn primary" href="/">
          Thử lại
        </a>
      </section>
    </main>
  );
}
