/**
 * German venue → Yahoo exchange suffix (brief Appendix B). Used to build the
 * Yahoo subscription symbol from a root symbol + venue. `.HM` (Hamburg) is closest
 * to the L&S environment, so it is preferred for apples-to-apples oracle compares.
 */
const SUFFIX: Record<string, string> = {
  XETRA: ".DE",
  HAMBURG: ".HM",
  STUTTGART: ".SG",
  FRANKFURT: ".F",
  MUNICH: ".MU",
  DUSSELDORF: ".DU",
  BERLIN: ".BE",
};

export function venueSuffix(venue: string): string | undefined {
  return SUFFIX[venue.toUpperCase()];
}

export function yahooSymbol(rootSymbol: string, venue: string): string {
  const suffix = venueSuffix(venue);
  return suffix !== undefined ? rootSymbol + suffix : rootSymbol;
}
