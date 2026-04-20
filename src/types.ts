export type LimitValue = {
  display: string;
  unit: "percent" | "unknown";
  value: number | null;
  raw: string;
};

export type StatusState = "ok" | "not_checked" | "auth_expired" | "parse_failed" | "timeout";

export type AccountStatus = {
  weeklyLimit: LimitValue;
  fiveHourLimit: LimitValue;
  checkedAt: string | null;
  source: string | null;
  rawSnippet: string;
  state: StatusState;
};

export type AccountEntry = {
  name: string;
  email: string;
  chatgptAccountId: string;
  planType: string;
  authPath: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  status: AccountStatus;
  notes: string;
};

export type Registry = {
  version: number;
  activeAccount: string | null;
  accounts: Record<string, AccountEntry>;
};

export type Paths = {
  cxauthHome: string;
  codexHome: string;
  registry: string;
  accountsDir: string;
  backupsDir: string;
  tmpDir: string;
  lock: string;
  globalAuth: string;
};
