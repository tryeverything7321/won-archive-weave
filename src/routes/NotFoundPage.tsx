import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { PageFrame } from "../components/PageFrame";

export function NotFoundPage() {
  return (
    <PageFrame
      variant="recovery"
      eyebrow="찾을 수 없는 페이지"
      title={
        <>
          찾고 있던 기록은
          <br /> 아직 이곳에 없어요
        </>
      }
      description="주소를 다시 확인하거나 다른 활동 기록을 살펴보세요."
    >
      <Link className="button button-primary" to="/archive">
        활동 기록으로 가기 <ArrowRight size={18} />
      </Link>
    </PageFrame>
  );
}
