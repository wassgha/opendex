import { registerToolView } from "../tool-registry";
import { TOOLS } from "./meta";

registerToolView({ name: TOOLS.listTricks, label: () => ({ icon: "✨", label: "Checking available tricks" }) });
registerToolView({ name: TOOLS.chooseTrick, label: () => ({ icon: "✨", label: "Choosing a demo" }) });
registerToolView({ name: TOOLS.showPlayground, label: () => ({ icon: "✦", label: "Opening the playground" }) });
