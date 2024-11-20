import React, { useState } from "react";
import { useOutlet } from "@tata1mg/router";

const BaseOutlet = () => {
  const o = useOutlet();
  const [outlet] = useState(o);

  return <>{outlet}</>;
};

const App = () => {
  return <BaseOutlet />;
};

export default App;
