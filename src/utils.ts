import { BigInt, Address, BigDecimal, ethereum, DataSourceContext } from '@graphprotocol/graph-ts'
import {
  BetokenFund,
} from "../generated/templates/BetokenFund/BetokenFund"

import {
  Fund
} from "../generated/schema"

import { MiniMeToken } from '../generated/templates/BetokenFund/MiniMeToken'
import { KyberNetwork } from "../generated/templates/BetokenFund/KyberNetwork"

// Constants

export let CyclePhase = new Array<string>()
CyclePhase.push('INTERMISSION')
CyclePhase.push('MANAGE')

export let VoteDirection = new Array<string>()
VoteDirection.push('EMPTY')
VoteDirection.push('FOR')
VoteDirection.push('AGAINST')

export let ZERO_INT = BigInt.fromI32(0)
export let ZERO_DEC = BigDecimal.fromString('0')
export let ONE_INT = BigInt.fromI32(1)
export let ONE_DEC = BigDecimal.fromString('1')
export let NEGONE_DEC = BigDecimal.fromString('-1')
export let PRECISION = new BigDecimal(tenPow(18))
export let KYBER_ADDR = Address.fromString("0x0d5371e5EE23dec7DF251A8957279629aa79E9C5")
export let DAI_ADDR = Address.fromString("0x5592ec0cfb4dbc12d3ab100b257153436a1f0fea")
export let CALLER_REWARD = BigDecimal.fromString('1')
export let RISK_THRESHOLD_TIME = BigInt.fromI32(3 * 24 * 60 * 60).toBigDecimal()
export let ETH_ADDR = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
export let ZERO_ADDR = '0x0000000000000000000000000000000000000000'
export let RECORD_INTERVAL = BigInt.fromI32(24 * 60 * 60 / 15) // 24 hours if avg block time is 15 seconds
export let PRICE_INTERVAL = BigInt.fromI32(5 * 60 / 15) // 5 minutes if avg block time is 15 seconds
export let LATEST_BLOCK = BigInt.fromI32(6986000 + 100)

export let PEAK_DECIMALS = 8

// Helpers

export function getFundEntity(context: DataSourceContext): Fund | null {
  let fundID = context.getString('ID')
  return Fund.load(fundID)
}

export function getFundID(context: DataSourceContext): string {
  let fundID = context.getString('ID')
  return fundID
}

export function updateTotalFunds(context: DataSourceContext): void {
  let fundID = context.getString('ID')
  let fund = Fund.load(fundID)
  let fundAddress = Address.fromString(fund.address)
  let fundContract = BetokenFund.bind(fundAddress)
  let kairo = kairoContract(fundAddress)
  let shares = sharesContract(fundAddress)
  fund.totalFundsInDAI = normalize(fundContract.totalFundsInDAI())
  fund.kairoPrice = normalize(fundContract.kairoPrice())
  fund.kairoTotalSupply = normalize(kairo.totalSupply())
  fund.sharesTotalSupply = normalize(shares.totalSupply())
  fund.save()
}

export function tenPow(exponent: number): BigInt {
  let result = BigInt.fromI32(1)
  for (let i = 0; i < exponent; i++) {
    result = result.times(BigInt.fromI32(10))
  }
  return result
}

export function kairoContract(fundAddress: Address): MiniMeToken {
  let fund = BetokenFund.bind(fundAddress)
  return MiniMeToken.bind(fund.controlTokenAddr())
}

export function sharesContract(fundAddress: Address): MiniMeToken {
  let fund = BetokenFund.bind(fundAddress)
  return MiniMeToken.bind(fund.shareTokenAddr())
}

export function getArrItem<T>(arr: Array<T>, idx: i32): T {
  let a = new Array<T>()
  a = a.concat(arr)
  return a[idx]
}

export function getTokenDecimals(tokenAddress: Address): i32 {
  let token = MiniMeToken.bind(tokenAddress)
  let decimals: i32
  if (ETH_ADDR.includes(tokenAddress.toHex())) {
    decimals = 18
  } else {
    decimals = token.decimals()
  }
  return decimals
}

export function getPriceOfToken(tokenAddress: Address, tokenAmount: BigInt): BigDecimal {
  let kyber = KyberNetwork.bind(KYBER_ADDR)
  let decimals: i32 = getTokenDecimals(tokenAddress)
  if (tokenAmount.gt(ZERO_INT)) {
    let result = kyber.try_getExpectedRate(tokenAddress, DAI_ADDR, tokenAmount)
    if (result.reverted) {
      return ZERO_DEC
    }
    return normalize(result.value.value0)
  } else {
    let result = kyber.try_getExpectedRate(tokenAddress, DAI_ADDR, tenPow(decimals))
    if (result.reverted) {
      return ZERO_DEC
    }
    return normalize(result.value.value0)
  }
}

export function normalize(i: BigInt, decimals: number = 18): BigDecimal {
  return i.toBigDecimal().div(tenPow(decimals).toBigDecimal())
}

export function toKairoROI(investmentROI: BigDecimal): BigDecimal {
  // don't change anything for v1
  let punishmentThreshold = BigDecimal.fromString('-0.1')
  let burnThreshold = BigDecimal.fromString('-0.25')
  let punishmentSlope = BigDecimal.fromString('6')
  let punishmentBias = BigDecimal.fromString('0.5')
  if (investmentROI.ge(punishmentThreshold)) {
    // no punishment
    return investmentROI
  } else if (investmentROI.lt(punishmentThreshold) && investmentROI.gt(burnThreshold)) {
    // punishment
    return investmentROI.times(punishmentSlope).plus(punishmentBias)
  } else {
    // burn
    return BigDecimal.fromString('-1')
  }
}