import { ArrowRight, CalendarPlus, LibraryBig } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Link } from "react-router-dom";
import { PageFrame } from "../components/PageFrame";
import { WeaveSymbol } from "../components/WeaveSymbol";
import { activities } from "../content";
import { sentence } from "../lib/text";

const intro =
  "일원상의 진리를 생활 속에서 공부하고 실천하는 원불교 청년들의 단체로서, 국내외 교당과 교구 청년회, 청년단체와의 연대를 바탕으로 구도인·봉공인·조화인·개벽인을 육성하며 세상을 밝히는 주체로서 광대무량한 낙원세계를 함께 만들어가는 것을 목적으로 합니다.";

const MotionLink = motion.create(Link);

function reveal(reduceMotion: boolean | null, offset = 42) {
  return {
    initial: reduceMotion ? false : { opacity: 0, y: offset, scale: 0.975 },
    whileInView: { opacity: 1, y: 0, scale: 1 },
    viewport: { once: true, amount: 0.24 },
    transition: {
      duration: reduceMotion ? 0 : 0.68,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
    },
  };
}

export function PlannerPage() {
  const recipes = activities.filter((activity) => activity.recipe);
  const reduceMotion = useReducedMotion();
  return (
    <PageFrame
      eyebrow="행사 준비 예시"
      title={
        <>
          먼저 해본 사람들의
          <br /> 준비 기록을 살펴봐요
        </>
      }
      description="행사를 준비하는 순서와 회고를 어떻게 남기는지 보여 주는 예시 모음입니다. 실제 공유 자료는 자료 나눔에서 찾아보세요."
    >
      <div className="planner-actions" aria-label="행사 준비 다음 행동">
        <Link className="button button-primary" to="/calendar/new">
          <CalendarPlus size={18} /> 행사 등록하기
        </Link>
        <Link className="button button-secondary" to="/resources">
          <LibraryBig size={18} /> 자료 나눔 보기
        </Link>
      </div>
      <div className="planner-grid" id="preparation-records">
        {recipes.map((activity, index) => (
          <MotionLink
            to={`/activities/${activity.slug}`}
            className={`planner-card ${activity.tone}`}
            key={activity.slug}
            {...reveal(reduceMotion, 54 + index * 10)}
            transition={{
              ...reveal(reduceMotion).transition,
              delay: reduceMotion ? 0 : index * 0.09,
            }}
            whileHover={
              reduceMotion
                ? undefined
                : { y: -10, rotateZ: index === 1 ? 0.35 : -0.35 }
            }
          >
            <span>{activity.type}</span>
            <h2>{activity.title}</h2>
            <p>
              {activity.recipe?.purpose && sentence(activity.recipe.purpose)}
            </p>
            <div>
              준비 기록 자세히 보기 <ArrowRight size={17} />
            </div>
          </MotionLink>
        ))}
      </div>
      <section className="future-note">
        <CalendarPlus size={20} />
        <div>
          <h2>행사를 열 계획이 있나요</h2>
          <p>
            행사 일정은 행사 캘린더에서 등록할 수 있어요. 이곳에서는 준비 과정과
            참고 자료를 모아 볼 수 있습니다.
          </p>
        </div>
      </section>
    </PageFrame>
  );
}

export function StartPage() {
  const reduceMotion = useReducedMotion();
  return (
    <PageFrame
      eyebrow="처음 만나는 원불교 청년회"
      title={
        <>
          궁금한 마음으로
          <br /> 들어와도 괜찮아요
        </>
      }
      description="신앙 여부와 관계없이 참여할 수 있어요. 생각을 나누고 함께 공부하며, 직접 움직이는 청년들의 만남을 만들어가요."
    >
      <div className="start-grid">
        <motion.section {...reveal(reduceMotion)}>
          <span className="start-number">01</span>
          <h2>무엇을 하는 곳인가요</h2>
          <p>
            함께 공부하고 활동하며 스스로를 진급시키는 원불교 청년 조직입니다.
          </p>
        </motion.section>
        <motion.section {...reveal(reduceMotion, 58)}>
          <span className="start-number">02</span>
          <h2>어디서 시작하면 좋을까요</h2>
          <p>
            지금 궁금한 주제를 살펴보고 마음이 가는 활동 기록부터 읽어 보세요.
          </p>
          <Link className="text-link" to="/archive">
            관심사로 기록 찾기 <ArrowRight size={17} />
          </Link>
        </motion.section>
        <motion.section {...reveal(reduceMotion, 72)}>
          <span className="start-number">03</span>
          <h2>처음이어도 참여할 수 있나요</h2>
          <p>
            처음 온 사람도 편안하게 어울릴 수 있도록 만남과 환대의 방법을 함께
            만들고 있습니다.
          </p>
          <Link className="text-link" to="/activities/first-time-visit">
            환대 가이드 보기 <ArrowRight size={17} />
          </Link>
        </motion.section>
      </div>
    </PageFrame>
  );
}

export function AboutPage() {
  const reduceMotion = useReducedMotion();
  return (
    <PageFrame
      variant="editorial"
      eyebrow="위브와 원불교 청년회"
      title={
        <>
          청년의 활동이
          <br /> 다음 사람에게 이어지는 곳
        </>
      }
      description="위브는 원불교 청년들의 활동 기록과 자료, 행사와 대화를 한곳에서 만나고 다음 활동으로 이어 가는 공간입니다."
    >
      <motion.section className="about-product" {...reveal(reduceMotion, 52)}>
        <header>
          <p>위브에서 하는 일</p>
          <h2>찾아보고 참여한 뒤<br /> 경험을 다시 나눕니다</h2>
          <span>
            처음 온 사람은 관심 있는 기록이나 가까운 행사부터 살펴볼 수 있습니다.
            활동을 마치면 과정과 자료를 남겨 다음 사람의 시작을 돕습니다.
          </span>
        </header>
        <ol className="about-journey" aria-label="위브 이용 흐름">
          <li>
            <span>01</span><strong>발견</strong>
            <p>관심 주제와 활동 형식으로 기록과 자료를 찾습니다.</p>
            <Link to="/archive">활동 기록 보기 <ArrowRight size={16} /></Link>
          </li>
          <li>
            <span>02</span><strong>참여</strong>
            <p>가까운 행사와 모임을 확인하고 마음 가는 만남을 고릅니다.</p>
            <Link to="/calendar">행사 일정 보기 <ArrowRight size={16} /></Link>
          </li>
          <li>
            <span>03</span><strong>기록과 나눔</strong>
            <p>활동의 과정과 결과, 다시 쓸 수 있는 자료를 함께 남깁니다.</p>
            <Link to="/contribute?intent=activity">활동 기록 남기기 <ArrowRight size={16} /></Link>
          </li>
          <li>
            <span>04</span><strong>다음 연결</strong>
            <p>경험과 노하우를 나누고 다음 활동에 필요한 실마리를 찾습니다.</p>
            <Link to="/community">대화 이어가기 <ArrowRight size={16} /></Link>
          </li>
        </ol>
      </motion.section>

      <motion.section className="about-association" {...reveal(reduceMotion, 64)}>
        <div className="about-association-mark">
          <img src="/brand/wby-mark.png" alt="원불교 청년회 상징" />
          <span>원불교 청년회</span>
        </div>
        <div className="about-association-copy">
          <p>위브를 운영하는 사람들</p>
          <h2>함께 공부하고<br /> 세상을 밝히는 청년들</h2>
          <span>{intro}</span>
          <h3>원불교 청년회 4대 이념</h3>
          <div className="ideals">
            <span>
              <b>자신에게</b> 믿음을
            </span>
            <span>
              <b>이웃에게</b> 은혜를
            </span>
            <span>
              <b>민족에게</b> 화합을
            </span>
            <span>
              <b>인류에게</b> 희망을
            </span>
          </div>
        </div>
      </motion.section>

      <motion.section
        className="about-brand-identity"
        id="weave-story"
        aria-labelledby="weave-story-title"
        {...reveal(reduceMotion, 48)}
      >
        <header>
          <p>위브의 브랜드 철학</p>
          <h2 id="weave-story-title">흩어진 기록을 엮어<br /> 다음 시작으로</h2>
          <span>
            Weave는 실을 엮는다는 뜻입니다. 위브는 곳곳에 흩어진 활동 기록과
            자료, 사람과 장소를 한곳에 쌓아 두는 데서 멈추지 않습니다. 먼저 해 본
            사람의 경험이 다음 사람의 질문을 줄이고, 새로운 만남과 실천을 시작하게
            하는 연결을 만듭니다.
          </span>
        </header>

        <div className="about-brand-beliefs" aria-label="위브가 기록을 다루는 방식">
          <article>
            <span>남기는 기록</span>
            <h3>결과뿐 아니라 과정을 남깁니다</h3>
            <p>
              무엇을 준비했고 어디서 막혔는지, 어떤 자료가 도움이 됐는지까지
              기록합니다. 한 번의 활동이 그 자리에서 사라지지 않도록 하기 위해서입니다.
            </p>
          </article>
          <article>
            <span>이어 쓰는 기록</span>
            <h3>다른 사람의 시작점이 됩니다</h3>
            <p>
              먼저 남긴 기록은 다른 청년과 지역이 자기 상황에 맞게 고쳐 쓸 수 있는
              바탕이 됩니다. 기록의 가치는 보관된 양보다 다시 쓰이는 순간에 생깁니다.
            </p>
          </article>
          <article>
            <span>다시 움직이는 기록</span>
            <h3>다음 만남과 활동으로 이어집니다</h3>
            <p>
              기록에서 자료를 찾고, 자료에서 질문과 대화가 생기며, 그 대화가 다음
              활동을 엽니다. 위브가 만들고 싶은 것은 멈춰 있는 창고가 아니라 계속
              움직이는 기록의 흐름입니다.
            </p>
          </article>
        </div>

        <section className="about-brand-colors" aria-labelledby="weave-colors-title">
          <header>
            <p>위브의 색</p>
            <h3 id="weave-colors-title">분위기를 덮는 색보다<br /> 역할이 분명한 색</h3>
            <span>
              화면 대부분은 밝고 차분하게 비워 사람과 기록이 먼저 보이도록 합니다.
              브랜드 색은 모든 배경을 칠하는 장식이 아니라, 이름을 기억하게 하고
              중요한 연결과 상태를 알려 주는 데 사용합니다.
            </span>
          </header>
          <div className="about-brand-palette">
            <article className="about-brand-color about-brand-color-navy">
              <i aria-hidden="true" />
              <div>
                <h4>깊은 네이비</h4>
                <code>#143957</code>
                <p>오래 쌓인 기록의 깊이와 믿을 수 있는 안내를 나타냅니다</p>
              </div>
            </article>
            <article className="about-brand-color about-brand-color-mint">
              <i aria-hidden="true" />
              <div>
                <h4>열린 민트</h4>
                <code>#BFE9DF</code>
                <p>서로 다른 기록과 사람이 만나 새 흐름이 열리는 순간을 보여 줍니다</p>
              </div>
            </article>
            <article className="about-brand-color about-brand-color-canvas">
              <i aria-hidden="true" />
              <div>
                <h4>쿨 뉴트럴</h4>
                <code>#F7FAF9</code>
                <p>사람과 기록을 방해하지 않고 오래 읽을 수 있게 하는 바탕입니다</p>
              </div>
            </article>
            <article className="about-brand-color about-brand-color-yellow">
              <i aria-hidden="true" />
              <div>
                <h4>작은 노랑</h4>
                <code>#F2CA52</code>
                <p>새 소식과 지금 살펴볼 다음 가능성을 알리는 작은 신호입니다</p>
              </div>
            </article>
          </div>
        </section>

        <div className="about-brand-assets-heading">
          <p>로고와 심볼</p>
          <h3>이름을 보여 주는 자리와<br /> 작게 기억되는 자리</h3>
          <span>
            워드마크와 W 심볼은 서로 다른 로고가 아닙니다. 위브라는 이름을 충분히
            보여 줄 수 있는지, 작은 화면에서도 또렷하게 알아볼 수 있어야 하는지에
            따라 역할을 나눕니다.
          </span>
        </div>
        <div className="about-brand-assets">
          <article className="about-brand-asset about-brand-asset-wordmark">
            <div className="about-brand-asset-visual">
              <img src="/brand/ot01-open-crest-primary.svg" alt="민트색 흐름과 네이비 Weave 글자로 이루어진 위브 워드마크" />
            </div>
            <div>
              <p>위브의 이름을 온전히 보여 줄 때</p>
              <h3>위브 워드마크</h3>
              <span>
                글자 위로 열린 민트색 흐름은 각자의 기록과 정성이 만나 만드는
                ‘청년들이 만드는 새로운 물결’을 나타냅니다. 그 아래 네이비 글자는
                위브라는 이름을 분명히 남깁니다. 넓은 화면의 헤더와 사이트 하단,
                소개처럼 브랜드 이름을 충분히 보여 줄 수 있는 자리에 사용합니다.
              </span>
            </div>
          </article>
          <article className="about-brand-asset about-brand-asset-symbol">
            <div className="about-brand-asset-visual">
              <WeaveSymbol label="위브 W 심볼" />
            </div>
            <div>
              <p>작은 자리에서 위브를 알아보게 할 때</p>
              <h3>위브 W 심볼</h3>
              <span>
                워드마크 첫 W의 열린 움직임을 작은 크기에서도 알아볼 수 있도록
                간결하게 남긴 표식입니다. 안으로 시작한 한 줄이 높이 올랐다가 낮은
                곡선으로 이어지며, 열려 있고 계속되는 위브의 인상을 유지합니다.
                브랜드 철학 전체를 그림 하나로 대신하는 표식은 아닙니다. 모바일
                헤더와 파비콘처럼 전체 이름을 쓰기 어려운 자리에서만 사용합니다.
              </span>
            </div>
          </article>
        </div>
        <p className="about-brand-usage-note">
          워드마크와 W 심볼은 나란히 겹쳐 쓰지 않습니다. 파일 형식이나 기능,
          로그인 방식과 상태를 나타내는 아이콘으로도 바꾸어 쓰지 않습니다.
        </p>
      </motion.section>

      <motion.section className="about-next" {...reveal(reduceMotion, 44)}>
        <div>
          <p>어디서 시작할지 고민된다면</p>
          <h2>지금 마음이 가는 기록부터</h2>
        </div>
        <div>
          <Link className="button button-primary" to="/archive">
            활동 기록 둘러보기 <ArrowRight size={18} />
          </Link>
          <Link className="button button-secondary" to="/start">
            처음 온 사람을 위한 안내
          </Link>
        </div>
      </motion.section>
    </PageFrame>
  );
}
