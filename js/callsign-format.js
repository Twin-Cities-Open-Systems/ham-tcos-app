/* callsign-format.js -- DERIVED COPY of fleet-ops ham/callsign/ui/format.js (the FCC
 * format rules, port of candidates.format_problem, parity-tested there). Do not edit
 * here; copy it again when the source changes. */
/* format.js -- the FCC's call sign format rules, for the call sign page.
 *
 * The same rules and the same messages as format_problem() in
 * ham/callsign/candidates.py. test_callsign.py runs both over one corpus and
 * fails if they disagree, so a rule changed in one place and not the other
 * does not ship. Sources: the ARRL vanity page's "Call Sign Choices Not
 * Available" list and Wikipedia's US call sign group table, read 2026-09-11.
 *
 * Zero dependencies. Loaded by ui/index.html; also require()-able by node for
 * the parity test.
 */
(function (root) {
  "use strict";

  function formatProblem(call) {
    var m = /^([A-Z]{1,2})([0-9])([A-Z]{1,3})$/.exec(call);
    if (!m) { return "not a 1-2 letter prefix, one digit 0-9, and a 1-3 letter suffix"; }
    var prefix = m[1], suffix = m[3];
    if (prefix.length === 1 && suffix.length === 1) { return "1x1 calls are reserved for special events"; }
    if ("AKNW".indexOf(prefix.charAt(0)) === -1 || prefix === "A") {
      return "prefix " + prefix + " is not a US amateur call sign prefix";
    }
    if (prefix.length === 2 && "HLP".indexOf(prefix.charAt(1)) !== -1) {
      return "prefix " + prefix + " needs an Alaska, Pacific or Caribbean mailing address";
    }
    if (prefix.charAt(0) === "A" && prefix.length === 2 && prefix.charAt(1) > "K") {
      return "prefix " + prefix + ": AM-AZ are assigned to other countries";
    }
    if (suffix.length === 3 && (suffix === "SOS" || (suffix >= "QRA" && suffix <= "QUZ"))) {
      return "suffix " + suffix + ": SOS and QRA-QUZ are not assigned";
    }
    if (prefix.length === 2 && suffix.length === 3) {
      if ("KW".indexOf(prefix.charAt(0)) === -1) {
        return "2x3 calls are assigned only with a KA-KZ or WA-WZ prefix, not " + prefix;
      }
      if (suffix.charAt(0) === "X") { return "2x3 calls whose suffix starts with X are not assigned"; }
    }
    return null;
  }

  root.TC = root.TC || {};
  root.TC.callsign = { formatProblem: formatProblem };
  if (typeof module !== "undefined" && module.exports) { module.exports = { formatProblem: formatProblem }; }
})(typeof window !== "undefined" ? window : globalThis);
