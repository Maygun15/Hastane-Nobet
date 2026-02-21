import React from "react";
import MonthlyLeavesMatrixGeneric from "./MonthlyLeavesMatrixGeneric.jsx";

export default function SchedulesBulkLeaves({
  people = [],
  year,
  month,              // 0-baz
  selectedService = null,
  leaveTypes = [],
}) {
  return (
    <MonthlyLeavesMatrixGeneric
      title="Çizelgeler • Toplu İzin Listesi"
      people={people}
      year={year}
      month={month}
      selectedService={selectedService}
      leaveTypes={leaveTypes}
      showExport={false}
    />
  );
}
