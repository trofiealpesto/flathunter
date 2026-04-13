import { Box, Heading, Text } from "gestalt";

import type { StatsSummary } from "../lib/api";

type StatsOverviewProps = {
  stats: StatsSummary | null;
};

export function StatsOverview({ stats }: StatsOverviewProps) {
  return (
    <div className="surface-card surface-card--stats">
      <Box color="default" rounding={6} padding={5}>
      <div className="panel-header">
        <Heading size="300" accessibilityLevel={2}>
          Snapshot
        </Heading>
        <Text size="100" color="subtle">
          Live aggregate from the protected API.
        </Text>
      </div>

      {stats ? (
        <div className="stats-grid">
          <div className="stat-card">
            <span>Total listings</span>
            <strong>{stats.totals.listings}</strong>
          </div>
          <div className="stat-card">
            <span>Matches</span>
            <strong>{stats.totals.match}</strong>
          </div>
          <div className="stat-card">
            <span>Unsure</span>
            <strong>{stats.totals.unsure}</strong>
          </div>
          <div className="stat-card">
            <span>Rejected</span>
            <strong>{stats.totals.reject}</strong>
          </div>
        </div>
      ) : (
        <div className="centered-block">No stats yet.</div>
      )}
      </Box>
    </div>
  );
}
