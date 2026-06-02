"use client";
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import LeaveSummary from "@/components/hr/leave/LeaveSummary";

// Read-only mirror of an employee's personal Leave page, shown to HR inside
// the employee profile (Attendance → Leave sub-view). Renders the SAME shared
// <LeaveSummary> the employee sees on their own side — but for the selected
// user, with no apply/request actions.

export default function EmployeeLeavePanel({ userId, userName }: { userId: number; userName: string }) {
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);
  const years = [nowYear, nowYear - 1, nowYear - 2];

  const { data: balances = [] } = useSWR(`/api/hr/leaves/balance?userId=${userId}&year=${year}`, fetcher);
  const { data: applications = [] } = useSWR(`/api/hr/leaves?userId=${userId}`, fetcher);

  return (
    <LeaveSummary
      balances={balances as any[]}
      applications={applications as any[]}
      year={year}
      years={years}
      onYearChange={setYear}
      readOnly
      subjectName={userName}
    />
  );
}
