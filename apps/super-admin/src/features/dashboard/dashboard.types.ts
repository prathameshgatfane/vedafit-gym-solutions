export interface PlatformDashboard {
  organizationsByStatus: {
    ACTIVE: number;
    SUSPENDED: number;
  };
  trialsEnding: number;
  signupsThisPeriod: number;
}
