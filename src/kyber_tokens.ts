export class TokenInfo {
  symbol: string
  name: string
  address: string
  decimals: number
}

export let KYBER_TOKENS: Array<TokenInfo> = [
  {
    "symbol" : "WBTC",
    "name" : "Wrapped BTC",
    "address" : "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    "decimals" : 8
  },
  {
    "symbol" : "ETH",
    "name" : "Ethereum",
    "address" : "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "decimals" : 18
  }
]