// What the framework knows of each region of PayRef: where it answers and its database, the
// rules of its money and of its codes, its time, and the amount a case pays when it does not
// say one.
export const regions = {
  mx: {
    portEnv: "PAYREF_MX_PORT",
    database: "payref_mx",
    amount: 150.5,
    decimals: 2,
    referenceLength: 14,
    utcOffset: "-06:00",
  },
  sa: {
    portEnv: "PAYREF_SA_PORT",
    database: "payref_sa",
    amount: 100,
    decimals: 0,
    referenceLength: 10,
    utcOffset: "-03:00",
  },
} as const;
