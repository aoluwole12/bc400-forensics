function Header() {
  return (
    <header className="app-header">
      <div className="logo-block">
        <div className="logo-text-main logo-text-main--single">
          BC400 FORENSICS
        </div>
        <div className="logo-tagline">
          bc400forensics.com · On-chain intelligence for Bitcoin Cultivation
          (BC400)
        </div>
      </div>

      <button className="logout-button" type="button">
        LOGOUT
      </button>
    </header>
  );
}

export default Header;