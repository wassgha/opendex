// Import each built-in tool view for its registration side-effect. Importing
// this module (via lib/tools) ensures every view is registered before the
// registry is queried.
import "./clock";
import "./weather";
import "./web-search";
import "./open";
import "./computer";
