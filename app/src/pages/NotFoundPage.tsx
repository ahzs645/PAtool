import { Link } from "react-router-dom";

import { Card, PageHeader } from "../components";

export default function NotFoundPage() {
  return (
    <Card>
      <PageHeader
        eyebrow="404"
        title="Page not found"
        subtitle="The route you followed does not match any workspace in PAtool. It may have been renamed or removed."
      />
      <p style={{ marginTop: "var(--spacing-3)" }}>
        <Link to="/">Return to the Explorer</Link>
      </p>
    </Card>
  );
}
