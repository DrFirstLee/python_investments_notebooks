#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { load as loadHtml } from "cheerio";
import axios from "axios";
import iconv from "iconv-lite";


const BASE = "https://finance.naver.com";


async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  });

  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

  // 1) ArrayBuffer로 가져옴 (중요!)
  const buffer = Buffer.from(await res.arrayBuffer());

  // 2) EUC-KR 디코딩
  const decoded = iconv.decode(buffer, "EUC-KR");

  // 3) cheerio 로딩
  return loadHtml(decoded);
}


// 숫자 텍스트 전처리 (쉼표 제거, 공백 제거 등)
// 실패하면 숫자 대신 원래 문자열을 반환해서 정보 손실 방지
function parseKoreanNumber(text) {
  if (!text) return null;
  const cleaned = text.replace(/,/g, "").replace(/\s+/g, "");
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}

/**
 * ETF: 정렬 기준에 따른 상위 ETF 리스트
 * etfType: 0 = 전체 (페이지 탭 기준)
 * targetColumn:
 *   - "market_sum"        시가총액(억)
 *   - "acc_quant"         거래량
 *   - "acc_amount"        거래대금(백만)
 *   - "change_rate"       등락률
 *   - "now_val"           현재가
 *   - "3month_earn_rate"  3개월 수익률
 * sortOrder: "desc" | "asc"
 */
async function getEtfsByMarketCap(
  limit = 50,
  etfType = 0,
  targetColumn = "acc_amount",
  sortOrder = "desc"
) {
  // 브라우저에서 사용하는 API 엔드포인트 그대로 사용
  const apiUrl =
    `${BASE}/api/sise/etfItemList.nhn?etfType=${etfType}` +
    `&targetColumn=${targetColumn}&sortOrder=${sortOrder}`;

  const res = await axios.get(apiUrl, {
    responseType: "arraybuffer", // euc-kr 이라 byte로 받아서 디코딩
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: `${BASE}/sise/etf.naver`,
    },
  });

  // JSON or JSONP 디코딩
  const decoded = iconv.decode(res.data, "euc-kr").trim();

  // JSONP 형식일 수 있으니 { ... } 부분만 추출
  const firstBrace = decoded.indexOf("{");
  const lastBrace = decoded.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("ETF API 응답에서 JSON을 찾을 수 없습니다.");
  }

  const jsonText = decoded.slice(firstBrace, lastBrace + 1);
  const json = JSON.parse(jsonText);

  if (json.resultCode !== "success") {
    throw new Error(`ETF API 오류: ${json.resultCode || "unknown"}`);
  }

  const list = json.result?.etfItemList ?? [];

  const items = list.slice(0, limit).map((etf) => {
    // etf 객체 구조는 tplEtfItemListTableBody 참고
    // { itemcode, itemname, nowVal, changeRate, nav, threeMonthEarnRate, quant, amonut, marketSum, ... }
    return {
      name: etf.itemname,
      code: etf.itemcode,

      currentPrice: {
        raw: String(etf.nowVal ?? ""),
        value: typeof etf.nowVal === "number" ? etf.nowVal : null,
      },

      nav: {
        raw: etf.nav == null ? "" : String(etf.nav),
        value: typeof etf.nav === "number" ? etf.nav : null,
      },

      changeRate:
        etf.changeRate == null
          ? null
          : etf.changeRate.toFixed
          ? etf.changeRate.toFixed(2)
          : String(etf.changeRate),

      threeMonthReturn:
        etf.threeMonthEarnRate == null
          ? null
          : etf.threeMonthEarnRate.toFixed
          ? etf.threeMonthEarnRate.toFixed(2)
          : String(etf.threeMonthEarnRate),

      volume: {
        raw: String(etf.quant ?? ""),
        value: typeof etf.quant === "number" ? etf.quant : null,
      },

      tradingValueMillion: {
        raw: String(etf.amonut ?? ""),
        value: typeof etf.amonut === "number" ? etf.amonut : null,
      },

      marketCapHundredMillion: {
        raw: String(etf.marketSum ?? ""),
        value: typeof etf.marketSum === "number" ? etf.marketSum : null,
      },
    };
  });

  return {
    url: apiUrl,
    items,
  };
}

export { getEtfsByMarketCap };



// 2) 테마: 전일대비 상승률 순 + 테마 주도주
async function getThemesWithLeaders(limit = 50) {
  const url = `${BASE}/sise/theme.naver`;
  const $ = await fetchHtml(url);
  const items = [];

  // 참고: 블로그 예제 기준으로 테마명은 col_type1 안의 <a> :contentReference[oaicite:3]{index=3}
  $("table tbody tr").each((_, el) => {
    const themeAnchor = $(el).find("td.col_type1 a").first();
    const themeName = themeAnchor.text().trim();
    if (!themeName) return;

    const href = themeAnchor.attr("href") || "";
    // /sise/sise_group_detail.naver?type=theme&no=237
    const themeNoMatch = href.match(/no=(\d+)/);
    const themeId = themeNoMatch ? themeNoMatch[1] : null;

    const tds = $(el).find("td");
    // 대체로 전일대비/등락률 컬럼이 뒤쪽에 위치
    const changeRateText = $(el)
    .find("td.col_type2 span")
    .text()
    .trim();
    // "주도주" 컬럼(대표종목) 추정: 뒤쪽 td에서 종목명 a 태그들 추출
    const leadersTd = tds.last();
    const leaders = leadersTd
      .find("a")
      .map((__, a) => $(a).text().trim())
      .get()
      .filter(Boolean);

    items.push({
      themeName,
      themeId,
      changeRate: changeRateText,
      leaders
    });

    if (items.length >= limit) return false;
  });

  return { url, items };
}

// 3) 시가총액 순 종목 (이름 + 현재가)
//   기본: KOSPI(sosok=0), 1페이지, 최대 50개
async function getMarketCapStocks({
  sosok = 0,
  page = 1,
  limit = 50
} = {}) {
  const url = `${BASE}/sise/sise_market_sum.naver?sosok=${sosok}&page=${page}`;
  const $ = await fetchHtml(url);
  const items = [];

  // Python 크롤링 예제 기준: table.type_2 tbody tr 구조 사용 :contentReference[oaicite:4]{index=4}
  $("table.type_2 tbody tr").each((_, el) => {
    const nameAnchor = $(el).find("td:nth-child(2) a").first();
    const name = nameAnchor.text().trim();
    if (!name) return;

    const href = nameAnchor.attr("href") || "";
    const codeMatch = href.match(/code=(\d{6})/);
    const code = codeMatch ? codeMatch[1] : null;

    const currentPriceText = $(el)
      .find("td:nth-child(3)")
      .text()
      .trim();

    items.push({
      name,
      code,
      currentPrice: {
        raw: currentPriceText,
        value: parseKoreanNumber(currentPriceText)
      }
    });

    if (items.length >= limit) return false;
  });

  return { url, items, sosok, page };
}

// 4) 배당수익률 높은 순 종목
// 4) 배당수익률 높은 순 종목
async function getDividendYieldStocks({ page = 1, limit = 50 } = {}) {
  const url = `${BASE}/sise/dividend_list.naver?page=${page}`;
  const $ = await fetchHtml(url);
  const items = [];

  // 실제 HTML: <table class="type_1 tb_ty">
  $('table.tb_ty tbody tr').each((_, el) => {
    // 종목명: <td class="txt frst"><a ...>레드캡투어</a></td>
    const nameAnchor = $(el).find('td.txt.frst a').first();
    const name = nameAnchor.text().trim();
    if (!name) return; // 공백 행(&nbsp;)들 스킵

    const href = nameAnchor.attr('href') || '';
    const codeMatch = href.match(/code=(\d{6})/);
    const code = codeMatch ? codeMatch[1] : null;

    const tds = $(el).find('td');

    // 컬럼 인덱스 매핑 (0부터 시작)
    // 0: 종목명
    const currentPriceText = tds.eq(1).text().trim(); // 현재가
    const baseMonthText = tds.eq(2).text().trim();    // 기준월 (예: 25.03)
    const dividendText = tds.eq(3).text().trim();     // 배당금
    const yieldText = tds.eq(4).text().trim();        // 수익률(%)
    const payoutRatioText = tds.eq(5).text().trim();  // 배당성향(%)

    items.push({
      name,
      code,
      currentPrice: {
        raw: currentPriceText,
        value: parseKoreanNumber(currentPriceText),
      },
      baseMonth: baseMonthText, // "25.03" 같은 문자열 그대로 둠
      dividend: {
        raw: dividendText,
        value: parseKoreanNumber(dividendText),
      },
      dividendYield: yieldText, // "18.57" 같은 문자열, 필요하면 숫자로 파싱해서 쓰면 됨
      payoutRatio: payoutRatioText, // 옵션 필드
    });

    if (items.length >= limit) return false; // cheerio each 탈출
  });

  return { url, items, page };
}

// 5) 종목명으로 검색해서 종목코드 가져오기 (리다이렉트 안전 버전)
async function searchStockCodeByName(query) {
  const url = `${BASE}/search/search.naver?query=${encodeURIComponent(query)}&encoding=UTF-8`;
  const $ = await fetchHtml(url);

  // 1단계: a[href*="/item/main.naver?code="]에서 코드/이름 찾기
  let firstItemLink = $("a")
    .filter((_, a) => {
      const href = $(a).attr("href") || "";
      return href.includes("/item/main.naver?code=");
    })
    .first();

  let name = firstItemLink.text().trim();
  let href = firstItemLink.attr("href") || "";
  let codeMatch = href.match(/code=(\d{6})/);
  let code = codeMatch ? codeMatch[1] : null;

  // 2단계: 위에서 못 찾았다면 (혹시 앵커에 code가 안 보이는 특이 케이스)
  if (!code) {
    // 페이지 전체 HTML에서 code=XXXXXX 패턴을 한 번 더 찾아본다
    const html = $.html() || "";
    const fallbackMatch = html.match(/code=(\d{6})/);
    if (fallbackMatch) {
      code = fallbackMatch[1];
      // 이름은 페이지 상단 회사명으로 한 번 더 시도
      const titleName =
        $("div.wrap_company h2 a").first().text().trim() ||
        $("div.wrap_company h2").first().text().trim();
      name = titleName || query; // 그래도 없으면 검색어 그대로
    }
  }

  if (!code) {
    return {
      url,
      result: null,
      message: "검색 결과에서 종목 코드를 찾지 못했습니다."
    };
  }

  return {
    url,
    result: {
      name: name || query, // 이름 못 찾으면 최소한 검색어라도 넣어줌
      code
    }
  };
}

// 6) 종목코드로 현재가 가져오기
async function getStockPriceByCode(code) {
  const url = `${BASE}/item/main.naver?code=${code}`;
  const $ = await fetchHtml(url);

  // 일반적으로 현재가는 p.no_today span.blind 안에 존재
  const priceText =
    $("p.no_today span.blind").first().text().trim() ||
    $("span#now_value").text().trim();

  const nameText =
    $("div.wrap_company h2 a")
      .first()
      .text()
      .trim() || $("div.wrap_company h2").text().trim();

  return {
    url,
    name: nameText || null,
    code,
    currentPrice: {
      raw: priceText,
      value: parseKoreanNumber(priceText)
    }
  };
}

// ───────────────────────────────────────────────────────────
// MCP 서버 초기화
// ───────────────────────────────────────────────────────────

// 공식 SDK 예제와 동일한 형태로 MCP 서버 구성 :contentReference[oaicite:5]{index=5}
const server = new McpServer({
  name: "korea-stock-mcp",
  version: "0.1.0"
});

server.registerTool(
  "get_etfs_by_market_cap",
  {
    title: "ETF 목록 조회",
    description:
      "네이버 금융에서 ETF 목록을 가져옵니다. 정렬 기준을 직접 지정할 수 있습니다.",
    inputSchema: z.object({
      limit: z.number().int().positive().max(500).default(50),
      etfType: z.number().int().min(0).max(7).default(0)
        .describe("ETF 탭 번호 (0=전체, 1~7)"),
      targetColumn: z.enum([
        "market_sum",
        "acc_quant",
        "acc_amount",
        "change_rate",
        "now_val",
        "3month_earn_rate"
      ]).default("market_sum")
        .describe("정렬 기준 컬럼"),
      sortOrder: z.enum(["asc", "desc"]).default("desc")
        .describe("정렬 방향")
    }),
    outputSchema: z.object({
      url: z.string().url(),
      items: z.array(
        z.object({
          name: z.string(),
          code: z.string().nullable(),
          currentPrice: z.object({
            raw: z.string(),
            value: z.number().nullable(),
          }),
          nav: z.object({
            raw: z.string(),
            value: z.number().nullable(),
          }),
          changeRate: z.string().nullable(),
          threeMonthReturn: z.string().nullable(),
          volume: z.object({
            raw: z.string(),
            value: z.number().nullable(),
          }),
          tradingValueMillion: z.object({
            raw: z.string(),
            value: z.number().nullable(),
          }),
          marketCapHundredMillion: z.object({
            raw: z.string(),
            value: z.number().nullable(),
          }),
        })
      )
    })
  },
  async ({ limit, etfType, targetColumn, sortOrder }) => {
    const output = await getEtfsByMarketCap(
      limit,
      etfType,
      targetColumn,
      sortOrder
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(output, null, 2)
        }
      ],
      structuredContent: output
    };
  }
);


// MCP Tool: 테마 + 주도주
server.registerTool(
  "get_themes_with_leaders",
  {
    title: "테마 상승률 + 주도주 조회",
    description:
      "https://finance.naver.com/sise/theme.naver 에서 전일대비 상승률이 높은 순으로 테마와 주도주 종목명을 가져옵니다.",
    inputSchema: {
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .default(50)
        .describe("최대 테마 개수 (기본 50)")
    },
    outputSchema: z.object({
      url: z.string().url(),
      items: z.array(
        z.object({
          themeName: z.string(),
          themeId: z.string().nullable(),
          changeRate: z.string().nullable(),
          leaders: z.array(z.string())
        })
      )
    })
  },
  async ({ limit }) => {
    const output = await getThemesWithLeaders(limit);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(output, null, 2)
        }
      ],
      structuredContent: output
    };
  }
);

// MCP Tool: 시가총액 상위 종목
server.registerTool(
  "get_market_cap_stocks",
  {
    title: "시가총액 상위 종목 조회",
    description:
      "https://finance.naver.com/sise/sise_market_sum.naver 에서 시가총액 순으로 종목 이름과 현재가 정보를 가져옵니다.",
    inputSchema: {
      sosok: z
        .number()
        .int()
        .optional()
        .describe("시장 코드 (0: 코스피, 1: 코스닥, 기본 0)"),
      page: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("페이지 번호 (기본 1)"),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .default(50)
        .describe("최대 결과 개수 (기본 50)")
    },
    outputSchema: z.object({
      url: z.string().url(),
      sosok: z.number().int(),
      page: z.number().int(),
      items: z.array(
        z.object({
          name: z.string(),
          code: z.string().nullable(),
          currentPrice: z.object({
            raw: z.string(),
            value: z.number().nullable()
          })
        })
      )
    })
  },
  async ({ sosok = 0, page = 1, limit }) => {
    const output = await getMarketCapStocks({ sosok, page, limit });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(output, null, 2)
        }
      ],
      structuredContent: output
    };
  }
);

// MCP Tool: 배당수익률 상위 종목
server.registerTool(
  "get_dividend_yield_stocks",
  {
    title: "배당수익률 상위 종목 조회",
    description:
      "https://finance.naver.com/sise/dividend_list.naver 에서 배당수익률이 높은 순으로 종목 정보를 가져옵니다.",
    inputSchema: {
      page: z
        .number()
        .int()
        .positive()
        .default(1)
        .describe("페이지 번호 (기본 1)"),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .default(50)
        .describe("최대 결과 개수 (기본 50)")
    },
    outputSchema: z.object({
      url: z.string().url(),
      page: z.number().int(),
      items: z.array(
        z.object({
          name: z.string(),
          code: z.string().nullable(),
          currentPrice: z.object({
            raw: z.string(),
            value: z.number().nullable()
          }),
          baseMonth: z.string().nullable(),
          dividend: z.object({
            raw: z.string(),
            value: z.number().nullable()
          }),
          dividendYield: z.string().nullable(),
          payoutRatio: z.string().nullable()
        })
      )
    })
  },
  async ({ page, limit }) => {
    const output = await getDividendYieldStocks({ page, limit });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(output, null, 2)
        }
      ],
      structuredContent: output
    };
  }
);

// MCP Tool: 종목명으로 종목코드 검색
server.registerTool(
  "search_stock_code",
  {
    title: "종목명으로 종목코드 검색",
    description:
      "https://finance.naver.com/search/search.naver?query={종목명} 을 사용하여 종목코드를 찾습니다.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe("검색할 종목명 (예: 삼성전자, NAVER 등)")
    },
    outputSchema: z.object({
      url: z.string().url(),
      result: z
        .object({
          name: z.string(),
          code: z.string()
        })
        .nullable(),
      message: z.string().optional()
    })
  },
  async ({ query }) => {
    const output = await searchStockCodeByName(query);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(output, null, 2)
        }
      ],
      structuredContent: output
    };
  }
);

// MCP Tool: 종목코드로 현재가 조회
server.registerTool(
  "get_stock_price_by_code",
  {
    title: "종목코드로 현재가 조회",
    description:
      "https://finance.naver.com/item/main.naver?code={종목코드} 를 사용하여 현재가 정보를 가져옵니다.",
    inputSchema: {
      code: z
        .string()
        .regex(/^\d{6}$/)
        .describe("6자리 종목코드 (예: 005930)")
    },
    outputSchema: z.object({
      url: z.string().url(),
      name: z.string().nullable(),
      code: z.string(),
      currentPrice: z.object({
        raw: z.string(),
        value: z.number().nullable()
      })
    })
  },
  async ({ code }) => {
    const output = await getStockPriceByCode(code);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(output, null, 2)
        }
      ],
      structuredContent: output
    };
  }
);

// STDIO 기반 MCP 서버 시작 (Claude Desktop 등에서 사용)
const transport = new StdioServerTransport();
await server.connect(transport);
