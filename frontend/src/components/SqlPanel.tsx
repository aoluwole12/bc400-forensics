function SqlPanel() {
  return (
    <section className="sql-panel" aria-label="SQL query runner">
      <div className="sql-panel-inner">
        <h2 className="sql-panel-title">
          EDIT AND RUN SQL
          <span className="sql-panel-title-break">
            COMMANDS TO GET RESULTS
          </span>
        </h2>

        <p className="sql-panel-helper">
          Hook this panel up to your <code>bc400-forensics</code> backend to let
          investigators run safe, parameterized SQL queries.
        </p>

        <button
          className="run-query-button"
          type="button"
          onClick={() => {
            // Placeholder: wire this up to open a modal or navigate to query page.
            // eslint-disable-next-line no-alert
            alert('Query runner not wired up yet.');
          }}
        >
          RUN QUERY
        </button>
      </div>
    </section>
  );
}

export default SqlPanel;