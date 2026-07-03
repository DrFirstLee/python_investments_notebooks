# korea-stock-mcp

네이버 금융 데이터를 MCP(Model Context Protocol)로 노출하는 Node.js 기반 서버입니다.  
Claude Desktop, Cursor 등 MCP 클라이언트에서 한국 ETF / 테마 / 시가총액 / 배당 / 개별 종목 가격을 직접 조회할 수 있게 해줍니다.

## 기능(툴) 요약

1. **get_etfs_by_market_cap**
   - `https://finance.naver.com/sise/etf.naver`
   - 시가총액 순으로 ETF 목록을 가져옵니다.
   - 입력
     - `limit` (number, optional, default 50): 최대 결과 개수
   - 출력
     - `items[]`: `{ name, code, currentPrice, nav, changeRate }`

2. **get_themes_with_leaders**
   - `https://finance.naver.com/sise/theme.naver`
   - 전일대비 상승이 높은 순으로 테마를 가져오고, 각 테마의 주도주 종목명을 함께 반환합니다.
   - 입력
     - `limit` (number, optional, default 50)
   - 출력
     - `items[]`: `{ themeName, themeId, changeRate, leaders[] }`

3. **get_market_cap_stocks**
   - `https://finance.naver.com/sise/sise_market_sum.naver`
   - 시가총액 순으로 종목 이름과 현재가 정보를 가져옵니다.
   - 입력
     - `sosok` (number, optional): 0=코스피, 1=코스닥 (기본 0)
     - `page` (number, optional, 기본 1)
     - `limit` (number, optional, 기본 50)
   - 출력
     - `items[]`: `{ name, code, currentPrice }`

4. **get_dividend_yield_stocks**
   - `https://finance.naver.com/sise/dividend_list.naver`
   - 배당수익률이 높은 순으로 종목 정보를 가져옵니다.
   - 입력
     - `page` (number, optional, 기본 1)
     - `limit` (number, optional, 기본 50)
   - 출력
     - `items[]`: `{ name, code, currentPrice, dividend, dividendYield }`

5. **search_stock_code**
   - `https://finance.naver.com/search/search.naver?query={종목명}`
   - 종목명으로 검색해서 종목코드를 가져옵니다.
   - 입력
     - `query` (string): 종목명 (예: `"삼성전자"`)
   - 출력
     - `result`: `{ name, code }` 또는 `null`

6. **get_stock_price_by_code**
   - `https://finance.naver.com/item/main.naver?code={종목코드}`
   - 종목코드로 현재가 정보를 가져옵니다.
   - 입력
     - `code` (string): 6자리 종목코드 (예: `"005930"`)
   - 출력
     - `{ name, code, currentPrice }`

> 모든 툴은 `structuredContent` 에 JSON 형태 결과를, `content[0].text` 에 pretty-printed JSON 문자열을 포함해서 반환합니다. MCP 클라이언트는 둘 중 편한 형태를 사용할 수 있습니다.

---

## 설치 및 실행

### 1) 로컬 개발용

```bash
# 프로젝트 초기화
npm install

# MCP 서버 실행 (STDIO)
node index.js
```

또는


```
npm start
```

### 2) npx 로 실행

패키지를 npm에 배포했다면, 다른 환경에서 다음과 같이 실행할 수 있습니다.

```
npx korea-stock-mcp
```
(로컬에서 테스트할 때는 npm link 로 글로벌 링크 후 npx korea-stock-mcp 또는 korea-stock-mcp 로 실행할 수 있습니다.)


---

## Claude Desktop 연동 예시

- `claude_desktop_config.json` 파일을 수정해줍니다.

```
{
  "mcpServers": {
    "korea-stock-mcp": {
      "command": "npx",
      "args": ["-y", "@drfirst/korea-stock-mcp@latest"]
    }
  }
}
```


---

## 사용 예시

예시 프롬프트:

> korea-stock-mcp를 활용해서 오늘의 주요 테마와 해당 테마 종목 조회  
> korea-stock-mcp를 활용해서 오늘 etf 정보 조회  
> korea-stock-mcp를 활용해서 오늘의 시가총액 순으로 주식종목 조회하기  
> korea-stock-mcp를 활용해서 티엘비의 시가 알아봐  