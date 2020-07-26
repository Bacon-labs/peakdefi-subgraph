import {
  CreateStake as CreateStakeEvent,
  WithdrawReward as WithdrawRewardEvent,
  WithdrawStake as WithdrawStakeEvent
} from '../../generated/PeakStaking/PeakStaking'
import {
  PeakStakingPool,
  PeakUser,
  PeakStakeEntry,
  PeakActivity
} from '../../generated/schema'
import * as Utils from '../utils'
import { Address, BigInt, BigDecimal } from '@graphprotocol/graph-ts'

function getStakingPool(): PeakStakingPool {
  let pool = PeakStakingPool.load('PeakStakingPool')
  if (pool == null) {
    pool = new PeakStakingPool('PeakStakingPool')
    pool.mintedPeakTokens = Utils.ZERO_DEC
    pool.stakeAmount = Utils.ZERO_DEC
    pool.totalWithdrawnStakeReward = Utils.ZERO_DEC
    pool.save()
  }
  return pool as PeakStakingPool
}

function getUser(address: Address): PeakUser {
  let entity = PeakUser.load(address.toHex())
  if (entity == null) {
    entity = new PeakUser(address.toHex())
    entity.address = address.toHex()
    entity.referrer = null
    entity.rank = Utils.ZERO_INT
    entity.careerValue = Utils.ZERO_DEC
    entity.referLevelUserCounts = new Array<BigInt>(8)
    entity.stakeAmount = Utils.ZERO_DEC
    entity.totalStakeReward = Utils.ZERO_DEC
    entity.totalWithdrawnStakeReward = Utils.ZERO_DEC
    entity.avgAPY = Utils.ZERO_DEC
    entity.save()
  }
  return entity as PeakUser
}

function calcUserAvgAPY(user: PeakUser): BigDecimal {
  let totalStake = Utils.ZERO_DEC
  let totalNormalizedReward = Utils.ZERO_DEC
  for (let i = 0; i < user.stakeList.length; i++) {
    let stakeEntry = PeakStakeEntry.load(Utils.getArrItem<string>(user.stakeList, i))
    if (stakeEntry.active) {
      totalStake = totalStake.plus(stakeEntry.stakeAmount)
      totalNormalizedReward = totalNormalizedReward.plus(stakeEntry.interestAmount.times(BigDecimal.fromString('365')).div(stakeEntry.stakeTimeInDays.toBigDecimal()))
    }
  }
  return totalNormalizedReward.div(totalStake)
}

export function handleCreateStake(event: CreateStakeEvent): void {
  let peakStakingPool = getStakingPool()
  let user = getUser(event.params.user)

  // create stake entry
  let entity = new PeakStakeEntry('PeakStakeEntry' + '-' + event.params.idx.toString())
  entity.idx = event.params.idx
  entity.staker = user.id
  entity.stakeAmount = Utils.normalize(event.params.stakeAmount, Utils.PEAK_DECIMALS)
  entity.interestAmount = Utils.normalize(event.params.interestAmount, Utils.PEAK_DECIMALS)
  entity.withdrawnInterestAmount = Utils.ZERO_DEC
  entity.stakeTimestamp = event.block.timestamp
  entity.stakeTimeInDays = event.params.stakeTimeInDays
  entity.active = true
  entity.save()

  // update user
  user.stakeAmount = user.stakeAmount.plus(entity.stakeAmount)
  user.totalStakeReward = user.totalStakeReward.plus(entity.interestAmount)
  user.avgAPY = calcUserAvgAPY(user)
  user.save()

  // update pool
  peakStakingPool.stakeAmount = peakStakingPool.stakeAmount.plus(entity.stakeAmount)
  peakStakingPool.mintedPeakTokens = peakStakingPool.mintedPeakTokens.plus(entity.interestAmount)
  peakStakingPool.save()

  // add activity entry
  let activity = new PeakActivity('PeakActivity' + '-' + user.id + '-' + event.transaction.hash.toHex() + '-' + event.transactionLogIndex.toString())
  activity.user = user.id
  activity.type = 'CreateStake'
  activity.timestamp = event.block.timestamp
  activity.txAmount = entity.stakeAmount
  activity.txHash = event.transaction.hash.toHex()
  activity.save()
}

export function handleWithdrawReward(event: WithdrawRewardEvent): void {
  let peakStakingPool = getStakingPool()
  let user = getUser(event.params.user)
  let entry = PeakStakeEntry.load('PeakStakeEntry' + '-' + event.params.idx.toString())

  let rewardAmount = Utils.normalize(event.params.rewardAmount, Utils.PEAK_DECIMALS)

  // update stake entry
  entry.withdrawnInterestAmount = entry.withdrawnInterestAmount.plus(rewardAmount)
  entry.save()

  // update user
  user.totalWithdrawnStakeReward = user.totalWithdrawnStakeReward.plus(rewardAmount)
  user.save()

  // update pool
  peakStakingPool.totalWithdrawnStakeReward = peakStakingPool.totalWithdrawnStakeReward.plus(rewardAmount)
  peakStakingPool.save()

  // add activity entry
  let activity = new PeakActivity('PeakActivity' + '-' + user.id + '-' + event.transaction.hash.toHex() + '-' + event.transactionLogIndex.toString())
  activity.user = user.id
  activity.type = 'WithdrawReward'
  activity.timestamp = event.block.timestamp
  activity.txAmount = rewardAmount
  activity.txHash = event.transaction.hash.toHex()
  activity.save()
}

export function handleWithdrawStake(event: WithdrawStakeEvent): void {
  let peakStakingPool = getStakingPool()
  let user = getUser(event.params.user)
  let entry = PeakStakeEntry.load('PeakStakeEntry' + '-' + event.params.idx.toString())

  // update stake entry
  entry.active = false
  entry.save()

  // update user
  user.stakeAmount = user.stakeAmount.minus(entry.stakeAmount)
  user.avgAPY = calcUserAvgAPY(user)
  user.save()

  // update pool
  peakStakingPool.stakeAmount = peakStakingPool.stakeAmount.minus(entry.stakeAmount)
  peakStakingPool.save()

  // add activity entry
  let activity = new PeakActivity('PeakActivity' + '-' + user.id + '-' + event.transaction.hash.toHex() + '-' + event.transactionLogIndex.toString())
  activity.user = user.id
  activity.type = 'WithdrawStake'
  activity.timestamp = event.block.timestamp
  activity.txAmount = entry.stakeAmount
  activity.txHash = event.transaction.hash.toHex()
  activity.save()
}