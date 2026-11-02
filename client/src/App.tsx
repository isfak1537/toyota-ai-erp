import { useEffect, useState } from "react";
import axios from "axios";

interface Dashboard {
  company: string;
  inventory: number;
  employees: number;
  machinesRunning: number;
  ordersToday: number;
}

function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);

  useEffect(() => {
    axios
      .get("http://localhost:5001/api/dashboard")
      .then((response) => {
        setDashboard(response.data);
      })
      .catch((error) => {
        console.error(error);
      });
  }, []);

  if (!dashboard) {
    return <h1>Loading...</h1>;
  }

  return (
    <div>
      <h1>{dashboard.company}</h1>
      <h2>Inventory: {dashboard.inventory}</h2>
      <h2>Employees: {dashboard.employees}</h2>
      <h2>Machines Running: {dashboard.machinesRunning}</h2>
      <h2>Today's Orders: {dashboard.ordersToday}</h2>
    </div>
  );
}

export default App;