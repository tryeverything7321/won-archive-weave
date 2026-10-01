import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "motion/react";
import type { MaterialFormatCount } from "./resource-discovery";
import styles from "./DiscoveryExperience.module.css";

const labels: Record<MaterialFormatCount["type"], string> = {
  TEXT: "글·회의록",
  IMAGE: "사진·포스터",
  TXT: "텍스트 파일",
  CSV: "표 데이터",
  FILE: "첨부 파일",
  PDF: "PDF",
  PPTX: "발표 자료",
  DOCX: "워드 문서",
  HWP: "한글 문서 (HWP)",
  HWPX: "한글 문서 (HWPX)",
  XLSX: "엑셀 자료",
  LINK: "웹 링크",
};

const colors = ["#143957", "#2f6f73", "#5b8f88", "#78aaa1", "#9bc9c0", "#bfe9df"];

export function MaterialFormatChart({ counts }: { counts: MaterialFormatCount[] }) {
  const reduceMotion = useReducedMotion();
  const chartData = counts.map((item) => ({ ...item, label: labels[item.type] }));
  const total = counts.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className={styles.chartLayout}>
      <div className={styles.chartCanvas} role="img" aria-label={`현재 불러온 실제 자료 ${total}개의 형식 분포 막대그래프`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart accessibilityLayer data={chartData} layout="vertical" margin={{ top: 8, right: 18, bottom: 8, left: 8 }}>
            <XAxis type="number" allowDecimals={false} domain={[0, "dataMax"]} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="label" width={88} tickLine={false} axisLine={false} />
            <Tooltip formatter={(value: unknown) => [`${String(value)}건`, "자료 수"]} cursor={{ fill: "rgba(191, 233, 223, 0.28)" }} />
            <Bar dataKey="count" radius={[0, 6, 6, 0]} isAnimationActive={!reduceMotion}>
              {chartData.map((item, index) => <Cell key={item.type} fill={colors[index % colors.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className={styles.chartLegend} aria-label="자료 형식별 건수">
        {chartData.map((item) => <li key={item.type}><span>{item.label}</span><strong>{item.count}건</strong></li>)}
      </ul>
    </div>
  );
}
