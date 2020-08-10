import {
  Register as RegisterEvent,
  RankChange as RankChangeEvent,
  PayCommission as PayCommissionEvent,
  ChangedCareerValue as ChangedCareerValueEvent
} from '../../generated/PeakReward/PeakReward'
import {
  PeakUser,
  PeakActivity,
  PeakCommission
} from '../../generated/schema'
import * as Utils from '../utils'
import { Address, BigInt, BigDecimal, log } from '@graphprotocol/graph-ts'

function getUser(address: Address): PeakUser {
  let entity = PeakUser.load(address.toHex())
  if (entity == null) {
    entity = new PeakUser(address.toHex())
    entity.address = address.toHex()
    entity.referrer = null
    entity.rank = Utils.ZERO_INT
    entity.careerValue = Utils.ZERO_DEC
    entity.totalDaiCommissionReceived = Utils.ZERO_DEC
    entity.totalPeakCommissionReceived = Utils.ZERO_DEC
    let newArray = new Array<BigInt>(8)
    for (let i = 0; i < 8; i++) {
      newArray[i] = Utils.ZERO_INT
    }
    entity.referLevelUserCounts = newArray
    let newDecArray = new Array<BigDecimal>(8)
    for (let i = 0; i < 8; i++) {
      newDecArray[i] = Utils.ZERO_DEC
    }
    entity.referLevelDaiCommissions = newDecArray
    entity.referLevelPeakCommissions = newDecArray
    entity.stakeAmount = Utils.ZERO_DEC
    entity.totalStakeReward = Utils.ZERO_DEC
    entity.totalWithdrawnStakeReward = Utils.ZERO_DEC
    entity.avgAPY = Utils.ZERO_DEC
    entity.stakeList = new Array<string>()
    entity.save()
  }
  return entity as PeakUser
}

export function handleRegister(event: RegisterEvent): void {
  let user = getUser(event.params.user)
  if (event.params.referrer.toHex() === Utils.ZERO_ADDR) {
    return
  }
  let referrer = getUser(event.params.referrer)

  // update user
  user.referrer = referrer.id
  user.save()

  // update referrer
  let ptr = referrer.id
  let level = 0
  while (ptr != null && level < 8) {
    let ptrEntity = PeakUser.load(ptr)
    let userCounts = ptrEntity.referLevelUserCounts
    userCounts[level] = userCounts[level].plus(Utils.ONE_INT)
    ptrEntity.referLevelUserCounts = userCounts
    ptrEntity.save()

    level += 1
    ptr = ptrEntity.referrer
  }
}

export function handleRankChange(event: RankChangeEvent): void {
  let user = getUser(event.params.user)

  // update user rank
  user.rank = event.params.newRank
  user.save()
}

export function handlePayCommission(event: PayCommissionEvent): void {
  let user = getUser(event.params.receipient)

  // add activity entry
  let activity = new PeakCommission('PeakActivity' + '-' + user.id + '-' + event.transaction.hash.toHex() + '-' + event.transactionLogIndex.toString())
  activity.user = user.id
  activity.timestamp = event.block.timestamp
  let decimals = Utils.getTokenDecimals(event.params.token)
  activity.txAmount = Utils.normalize(event.params.amount, decimals)
  activity.token = event.params.token.toHex()
  activity.receipient = event.params.receipient.toHex()
  activity.level = BigInt.fromI32(event.params.level).plus(Utils.ONE_INT)
  activity.save()

  // update user
  if (event.params.token.equals(Utils.DAI_ADDR)) {
    user.totalDaiCommissionReceived = user.totalDaiCommissionReceived.plus(activity.txAmount)
    let referLevelDaiCommissions = user.referLevelDaiCommissions
    referLevelDaiCommissions[event.params.level] = referLevelDaiCommissions[event.params.level].plus(activity.txAmount)
    user.referLevelDaiCommissions = referLevelDaiCommissions
  } else {
    user.totalPeakCommissionReceived = user.totalPeakCommissionReceived.plus(activity.txAmount)
    let referLevelPeakCommissions = user.referLevelPeakCommissions
    referLevelPeakCommissions[event.params.level] = referLevelPeakCommissions[event.params.level].plus(activity.txAmount)
    user.referLevelPeakCommissions = referLevelPeakCommissions
  }
  user.save()
}

export function handleChangedCareerValue(event: ChangedCareerValueEvent): void {
  let user = getUser(event.params.user)

  // update user CV
  let changeAmount = Utils.normalize(event.params.changeAmount).times(event.params.positive ? Utils.ONE_DEC : Utils.NEGONE_DEC)
  user.careerValue = user.careerValue.plus(changeAmount)
  user.save()
}