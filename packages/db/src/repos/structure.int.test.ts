// One test file, one throwaway database clone: the structural suites share a database so that the integration run
// keeps few clones alive at once (the test cluster keeps its data in a 256 MB tmpfs). Each suite lives in its own
// *.suite.ts file and registers its tests when imported.
import "./schema.suite.ts";
import "./journals.suite.ts";
import "./integrity.suite.ts";
import "./roles.suite.ts";
import "./views.suite.ts";
import "./drift.suite.ts";
