import {
  ChangedPhase as ChangedPhaseEvent,
  Deposit as DepositEvent,
  Withdraw as WithdrawEvent,
  CreatedInvestment as CreatedInvestmentEvent,
  SoldInvestment as SoldInvestmentEvent,
  CreatedCompoundOrder as CreatedCompoundOrderEvent,
  SoldCompoundOrder as SoldCompoundOrderEvent,
  CommissionPaid as CommissionPaidEvent,
  TotalCommissionPaid as TotalCommissionPaidEvent,
  Register as RegisterEvent,
  SignaledUpgrade as SignaledUpgradeEvent,
  DeveloperInitiatedUpgrade as DeveloperInitiatedUpgradeEvent,
  InitiatedUpgrade as InitiatedUpgradeEvent,
  ProposedCandidate as ProposedCandidateEvent,
  Voted as VotedEvent,
  FinalizedNextVersion as FinalizedNextVersionEvent,
  BurnDeadman as BurnDeadmanEvent,
  BetokenFund,
} from "../../generated/templates/BetokenFund/BetokenFund"

import {
  Manager,
  BasicOrder,
  CompoundOrder,
  CommissionRedemption,
  Investor,
  DepositWithdraw,
  Fund,
  DataPoint,
  ManagerROI,
  TokenPrice
} from "../../generated/schema"

import { CompoundOrder as CompoundOrderContract } from '../../generated/templates/BetokenFund/CompoundOrder'
import { MiniMeToken } from '../../generated/templates/MiniMeToken/MiniMeToken'

import { BigInt, Address, BigDecimal, log, ethereum, dataSource } from '@graphprotocol/graph-ts'

import * as Utils from '../utils'
import { TokenInfo, KYBER_TOKENS } from '../kyber_tokens'

// Handlers

export function handleChangedPhase(event: ChangedPhaseEvent): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let entity = Utils.getFundEntity(context);
  let fund = BetokenFund.bind(event.address)
  let kairo = MiniMeToken.bind(fund.controlTokenAddr())

  Utils.updateTotalFunds(context)
  entity.totalFundsInDAI = Utils.normalize(event.params._totalFundsInDAI)

  // record cycle ROI
  let shouldRecordROI = event.params._newPhase.equals(Utils.ZERO_INT) && !event.params._cycleNumber.equals(BigInt.fromI32(1)) && event.params._cycleNumber.equals(BigInt.fromI32(entity.cycleROIHistory.length + 2))
  if (shouldRecordROI) {
    let currentTotalFundsInDAI = entity.totalFundsInDAI
    let cycleROI = currentTotalFundsInDAI.minus(entity.totalFundsAtPhaseStart).div(entity.totalFundsAtPhaseStart)
    let cycleROIHistory = entity.cycleROIHistory
    cycleROIHistory.push(cycleROI)
    entity.cycleROIHistory = cycleROIHistory
  }

  entity.cycleNumber = event.params._cycleNumber
  entity.cyclePhase = Utils.CyclePhase[event.params._newPhase.toI32()]
  entity.startTimeOfCyclePhase = event.block.timestamp
  entity.candidates = new Array<string>()
  entity.proposers = new Array<string>()
  entity.forVotes = new Array<BigDecimal>()
  entity.againstVotes = new Array<BigDecimal>()
  entity.upgradeVotingActive = fund.upgradeVotingActive()
  entity.upgradeSignalStrength = Utils.normalize(fund.upgradeSignalStrength(entity.cycleNumber))
  entity.nextVersion = fund.nextVersion().toHex()
  entity.totalFundsAtPhaseStart = entity.totalFundsInDAI
  entity.save()

  let caller = event.transaction.from.toHex()
  for (let m: i32 = 0; m < entity.managers.length; m++) {
    let manager = Manager.load(Utils.getArrItem<string>(entity.managers, m))
    manager.kairoBalance = Utils.normalize(kairo.balanceOf(Address.fromString(manager.id)))

    // record manager ROI
    if (shouldRecordROI) {
      let roi = new ManagerROI(Utils.getFundID(context) + '-' + manager.id + '-' + entity.cycleNumber.toString())
      roi.manager = manager.id
      roi.fund = Utils.getFundID(context)
      roi.cycle = entity.cycleNumber.minus(BigInt.fromI32(1))
      let callReward = manager.id === caller ? Utils.CALLER_REWARD : Utils.ZERO_DEC;
      roi.roi = manager.baseStake.equals(Utils.ZERO_DEC) ? Utils.ZERO_DEC : manager.kairoBalance.minus(callReward).div(manager.baseStake).minus(BigDecimal.fromString('1')).times(BigDecimal.fromString('100'))
      roi.kairoBalance = manager.kairoBalance
      roi.save()
      let roiHistory = manager.roiHistory
      roiHistory.push(roi.id)
      manager.roiHistory = roiHistory
    }

    manager.baseStake = manager.kairoBalance
    manager.kairoBalanceWithStake = manager.kairoBalance
    manager.riskTaken = Utils.ZERO_DEC
    manager.riskThreshold = manager.baseStake.times(Utils.RISK_THRESHOLD_TIME)
    manager.upgradeSignal = false;
    manager.votes = new Array<string>();
    manager.save()
  }
}

export function handleDeposit(event: DepositEvent): void {
  handleBlock(event.block)
  let context = dataSource.context()
  let fund = BetokenFund.bind(event.address)
  let shares = MiniMeToken.bind(fund.shareTokenAddr())

  let investor = Investor.load(Utils.getFundID(context) + '-' + event.params._sender.toHex())
  if (investor == null) {
    investor = new Investor(Utils.getFundID(context) + '-' + event.params._sender.toHex())
    investor.fund = Utils.getFundID(context)
    investor.depositWithdrawHistory = new Array<string>()
    investor.sharesBalance = Utils.ZERO_DEC
    investor.save()
  }

  let entity = new DepositWithdraw(
    Utils.getFundID(context) + '-' + event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  )
  entity.fund = Utils.getFundID(context)
  entity.amountInDAI = Utils.normalize(event.params._daiAmount)
  entity.timestamp = event.params._timestamp
  entity.isDeposit = true
  entity.txHash = event.transaction.hash.toHex()
  entity.save()

  
  investor.sharesBalance = Utils.normalize(shares.balanceOf(Address.fromString(investor.id)))
  let history = investor.depositWithdrawHistory
  history.push(entity.id)
  investor.depositWithdrawHistory = history
  investor.save()

  Utils.updateTotalFunds(context)
}

export function handleWithdraw(event: WithdrawEvent): void {
  handleBlock(event.block)
  let context = dataSource.context()
  let fund = BetokenFund.bind(event.address)
  let shares = MiniMeToken.bind(fund.shareTokenAddr())

  let investor = Investor.load(Utils.getFundID(context) + '-' + event.params._sender.toHex())
  if (investor == null) {
    investor = new Investor(Utils.getFundID(context) + '-' + event.params._sender.toHex())
    investor.depositWithdrawHistory = new Array<string>()
    investor.save()
  }

  let entity = new DepositWithdraw(
    Utils.getFundID(context) + '-' + event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  )
  entity.fund = Utils.getFundID(context)
  entity.amountInDAI = Utils.normalize(event.params._daiAmount)
  entity.timestamp = event.params._timestamp
  entity.isDeposit = false
  entity.txHash = event.transaction.hash.toHex()
  entity.save()

  investor.sharesBalance = Utils.normalize(shares.balanceOf(Address.fromString(investor.id)))
  let history = investor.depositWithdrawHistory
  history.push(entity.id)
  investor.depositWithdrawHistory = history
  investor.save()

  Utils.updateTotalFunds(context)
}

export function handleCreatedInvestment(event: CreatedInvestmentEvent): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let id = Utils.getFundID(context) + '-' + event.params._sender.toHex() + '-' + event.params._cycleNumber.toString() + '-' + event.params._id.toString()
  let tokenContract = MiniMeToken.bind(event.params._tokenAddress)
  let decimals: i32
  if (Utils.ETH_ADDR.includes(event.params._tokenAddress.toHex())) {
    decimals = 18
  } else {
    decimals = tokenContract.decimals()
  }
  let entity = new BasicOrder(id);
  entity.fund = Utils.getFundID(context)
  entity.owner = event.params._sender.toHex()
  entity.idx = event.params._id
  entity.cycleNumber = event.params._cycleNumber
  entity.tokenAddress = event.params._tokenAddress.toHex()
  entity.tokenAmount = event.params._tokenAmount.toBigDecimal().div(Utils.tenPow(decimals).toBigDecimal())
  entity.stake = Utils.normalize(event.params._stakeInWeis)
  entity.buyPrice = Utils.normalize(event.params._buyPrice)
  entity.sellPrice = Utils.getPriceOfToken(event.params._tokenAddress, event.params._tokenAmount)
  entity.buyTime = event.block.timestamp
  entity.sellTime = Utils.ZERO_INT
  entity.isSold = false
  entity.rawTokenAmount = event.params._tokenAmount;
  entity.txHash = event.transaction.hash.toHex()
  entity.save()

  let manager = Manager.load(Utils.getFundID(context) + '-' + event.params._sender.toHex())
  let orders = manager.basicOrders
  orders.push(id)
  manager.basicOrders = orders
  let fundContract = BetokenFund.bind(event.address)
  let kairo = MiniMeToken.bind(fundContract.controlTokenAddr())
  manager.kairoBalance = Utils.normalize(kairo.balanceOf(event.params._sender))
  manager.save()

  let fund = Utils.getFundEntity(context)
  fund.kairoTotalSupply = Utils.normalize(kairo.totalSupply())
  fund.save()
}

export function handleSoldInvestment(event: SoldInvestmentEvent): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let fund = BetokenFund.bind(event.address)
  let investmentObj = fund.userInvestments(event.params._sender, event.params._id)
  let tokenDecimals = Utils.getTokenDecimals(event.params._tokenAddress)
  let id = Utils.getFundID(context) + '-' + event.params._sender.toHex() + '-' + event.params._cycleNumber.toString() + '-' + event.params._id.toString()
  let entity = BasicOrder.load(id);
  entity.isSold = true
  entity.sellTime = event.block.timestamp
  entity.sellPrice = Utils.normalize(event.params._sellPrice)
  entity.stake = Utils.normalize(investmentObj.value2)
  entity.rawTokenAmount = investmentObj.value3
  entity.tokenAmount = entity.rawTokenAmount.divDecimal(Utils.tenPow(tokenDecimals).toBigDecimal())
  entity.save()

  Utils.updateTotalFunds(context)

  let manager = Manager.load(Utils.getFundID(context) + '-' + event.params._sender.toHex())
  let kairo = MiniMeToken.bind(fund.controlTokenAddr())
  manager.kairoBalance = Utils.normalize(kairo.balanceOf(event.params._sender))
  manager.save()

  let fundEntity = Utils.getFundEntity(context)
  fundEntity.kairoTotalSupply = Utils.normalize(kairo.totalSupply())
  fundEntity.save()
}

export function handleCreatedCompoundOrder(
  event: CreatedCompoundOrderEvent
): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let id = Utils.getFundID(context) + '-' + event.params._sender.toHex() + '-' + event.params._cycleNumber.toString() + '-' + event.params._id.toString()
  let entity = new CompoundOrder(id)
  entity.fund = Utils.getFundID(context)
  entity.owner = event.params._sender.toHex()
  entity.idx = event.params._id
  entity.cycleNumber = event.params._cycleNumber
  entity.tokenAddress = event.params._tokenAddress.toHex()
  entity.stake = Utils.normalize(event.params._stakeInWeis)
  entity.collateralAmountInDAI = Utils.normalize(event.params._costDAIAmount)
  entity.buyTokenPrice = Utils.getPriceOfToken(event.params._tokenAddress, Utils.ZERO_INT)
  entity.buyTime = event.block.timestamp
  entity.sellTime = Utils.ZERO_INT
  entity.isShort = event.params._orderType
  entity.isSold = false
  entity.orderAddress = event.params._order.toHex()
  entity.outputAmount = Utils.ZERO_DEC
  entity.txHash = event.transaction.hash.toHex()

  let contract = CompoundOrderContract.bind(event.params._order)
  entity.marketCollateralFactor = Utils.normalize(contract.getMarketCollateralFactor())
  entity.collateralRatio = Utils.normalize(contract.getCurrentCollateralRatioInDAI())
  let currProfitObj = contract.getCurrentProfitInDAI() // value0: isNegative, value1: value
  entity.currProfit = Utils.normalize(currProfitObj.value1.times(currProfitObj.value0 ? BigInt.fromI32(-1) : BigInt.fromI32(1)))
  entity.currCollateral = Utils.normalize(contract.getCurrentCollateralInDAI())
  entity.currBorrow = Utils.normalize(contract.getCurrentBorrowInDAI())
  entity.currCash = Utils.normalize(contract.getCurrentCashInDAI())
  entity.save()

  let manager = Manager.load(Utils.getFundID(context) + '-' + event.params._sender.toHex())
  let orders = manager.compoundOrders
  orders.push(entity.id)
  manager.compoundOrders = orders
  let fund = BetokenFund.bind(event.address)
  let kairo = MiniMeToken.bind(fund.controlTokenAddr())
  manager.kairoBalance = Utils.normalize(kairo.balanceOf(event.params._sender))
  manager.save()

  let fundEntity = Utils.getFundEntity(context)
  fundEntity.kairoTotalSupply = Utils.normalize(kairo.totalSupply())
  fundEntity.save()
}

export function handleSoldCompoundOrder(event: SoldCompoundOrderEvent): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let id = Utils.getFundID(context) + '-' + event.params._sender.toHex() + '-' + event.params._cycleNumber.toString() + '-' + event.params._id.toString()
  let entity = CompoundOrder.load(id)
  entity.isSold = true
  entity.sellTime = event.block.timestamp
  entity.outputAmount = Utils.normalize(event.params._earnedDAIAmount)
  entity.save()

  Utils.updateTotalFunds(context)

  let manager = Manager.load(Utils.getFundID(context) + '-' + event.params._sender.toHex())
  let fund = BetokenFund.bind(event.address)
  let kairo = MiniMeToken.bind(fund.controlTokenAddr())
  manager.kairoBalance = Utils.normalize(kairo.balanceOf(event.params._sender))
  manager.save()
  
  let fundEntity = Utils.getFundEntity(context)
  fundEntity.kairoTotalSupply = Utils.normalize(kairo.totalSupply())
  fundEntity.save()
}

export function handleCommissionPaid(event: CommissionPaidEvent): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let entity = new CommissionRedemption(
    Utils.getFundID(context) + '-' + event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  )
  entity.fund = Utils.getFundID(context)
  entity.timestamp = event.block.timestamp
  entity.cycleNumber = event.params._cycleNumber
  entity.amountInDAI = Utils.normalize(event.params._commission)
  entity.txHash = event.transaction.hash.toHex()
  entity.save()

  let manager = Manager.load(Utils.getFundID(context) + '-' + event.params._sender.toHex())
  let history = manager.commissionHistory
  history.push(entity.id)
  manager.commissionHistory = history
  manager.lastCommissionRedemption = entity.cycleNumber
  manager.totalCommissionReceived = manager.totalCommissionReceived.plus(entity.amountInDAI)
  manager.save()
}

export function handleTotalCommissionPaid(event: TotalCommissionPaidEvent): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let entity = Utils.getFundEntity(context)
  entity.cycleTotalCommission = Utils.normalize(event.params._totalCommissionInDAI)
  entity.save()
}

export function handleRegister(event: RegisterEvent): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let entity = new Manager(Utils.getFundID(context) + '-' + event.params._manager.toHex())
  entity.fund = Utils.getFundID(context)
  entity.kairoBalance = Utils.normalize(event.params._kairoReceived)
  entity.kairoBalanceWithStake = entity.kairoBalance
  entity.baseStake = entity.kairoBalance
  entity.riskTaken = Utils.ZERO_DEC
  entity.riskThreshold = entity.baseStake.times(Utils.RISK_THRESHOLD_TIME)
  entity.lastCommissionRedemption = Utils.ZERO_INT
  entity.basicOrders = new Array<string>()
  entity.compoundOrders = new Array<string>()
  entity.commissionHistory = new Array<string>()
  entity.roiHistory = new Array<string>()
  entity.votes = new Array<string>()
  entity.upgradeSignal = false
  entity.totalCommissionReceived = Utils.ZERO_DEC
  entity.save()

  Utils.updateTotalFunds(context)

  let fund = Utils.getFundEntity(context)
  let managers = fund.managers
  managers.push(entity.id)
  fund.managers = managers
  let fundContract = BetokenFund.bind(event.address)
  let kairo = MiniMeToken.bind(fundContract.controlTokenAddr())
  fund.kairoTotalSupply = Utils.normalize(kairo.totalSupply())
  fund.save()
}

export function handleBurnDeadman(event: BurnDeadmanEvent): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let managerAddr = event.params._manager
  let manager = Manager.load(Utils.getFundID(context) + '-' + managerAddr.toHex());
  manager.kairoBalance = Utils.ZERO_DEC
  manager.baseStake = manager.kairoBalance
  manager.kairoBalanceWithStake = manager.kairoBalance
  manager.riskTaken = Utils.ZERO_DEC
  manager.riskThreshold = manager.baseStake.times(Utils.RISK_THRESHOLD_TIME)
  manager.upgradeSignal = false;
  manager.votes = new Array<string>();
  manager.save()
}

export function handleSignaledUpgrade(event: SignaledUpgradeEvent): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let manager = Manager.load(Utils.getFundID(context) + '-' + event.params._sender.toHex())
  manager.upgradeSignal = event.params._inSupport
  manager.save()

  let entity = Utils.getFundEntity(context)
  let fund = BetokenFund.bind(event.address)
  entity.upgradeSignalStrength = Utils.normalize(fund.upgradeSignalStrength(entity.cycleNumber))
  entity.save()
}

export function handleDeveloperInitiatedUpgrade(
  event: DeveloperInitiatedUpgradeEvent
): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let entity = Utils.getFundEntity(context)
  entity.upgradeVotingActive = true
  entity.nextVersion = event.params._candidate.toHex()
  entity.save()
}

export function handleInitiatedUpgrade(event: InitiatedUpgradeEvent): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let entity = Utils.getFundEntity(context)
  entity.upgradeVotingActive = true
  entity.save()
}

export function handleProposedCandidate(event: ProposedCandidateEvent): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let entity = Utils.getFundEntity(context)
  let fund = BetokenFund.bind(event.address)
  let candidates = new Array<string>()
  let proposers = new Array<string>()
  for (let i = 0; i < 5; i++) {
    candidates.push(fund.candidates(BigInt.fromI32(i)).toHex())
    proposers.push(fund.proposers(BigInt.fromI32(i)).toHex())
  }
  entity.candidates = candidates
  entity.proposers = proposers
  entity.save()
}

export function handleVoted(event: VotedEvent): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let entity = Utils.getFundEntity(context)
  let fund = BetokenFund.bind(event.address)
  let forVotes = new Array<BigDecimal>()
  let againstVotes = new Array<BigDecimal>()
  for (let i = 0; i < 5; i++) {
    forVotes.push(Utils.normalize(fund.forVotes(BigInt.fromI32(i))))
    againstVotes.push(Utils.normalize(fund.againstVotes(BigInt.fromI32(i))))
  }
  entity.forVotes = forVotes
  entity.againstVotes = againstVotes
  entity.save()

  let manager = Manager.load(Utils.getFundID(context) + '-' + event.params._sender.toHex())
  let votes = new Array<string>()
  for (let i = 0; i < 5; i++) {
    votes.push(Utils.VoteDirection[fund.managerVotes(fund.cycleNumber(), event.params._sender, BigInt.fromI32(i))])
  }
  manager.votes = votes
  manager.save()
}

export function handleFinalizedNextVersion(
  event: FinalizedNextVersionEvent
): void {
  handleBlock(event.block)
  let context = dataSource.context()

  let entity = Utils.getFundEntity(context)
  entity.hasFinalizedNextVersion = true
  entity.nextVersion = event.params._nextVersion.toHexString()
  entity.save()
}

// block handler

export function handleBlock(block: ethereum.Block): void {
  let context = dataSource.context()
  let fundID = context.getString('ID')
  let fund = Fund.load(fundID)
  if (fund != null) {
    fund.lastProcessedBlock = block.number
    fund.save()

    // update prices every 5 minutes
    if ((block.number.ge(Utils.LATEST_BLOCK) && block.number.mod(Utils.PRICE_INTERVAL).isZero()) || (block.number.lt(Utils.LATEST_BLOCK) && block.number.mod(Utils.RECORD_INTERVAL).isZero())) {
      log.info("Updating price for block: {}", [block.number.toString()])

      let fundContract = BetokenFund.bind(Address.fromString(fund.address))
      let kairo = MiniMeToken.bind(fundContract.controlTokenAddr())
      fund.kairoTotalSupply = Utils.normalize(kairo.totalSupply())
      fund.save()

      let tentativeTotalInvestmentValueInKairo = Utils.ZERO_DEC
      if (fund.cycleNumber.gt(Utils.ZERO_INT) && fund.cyclePhase.includes(Utils.CyclePhase[1])) {
        for (let m = 0; m < fund.managers.length; m++) {
          let manager = Manager.load(Utils.getArrItem<string>(fund.managers, m))
          let riskTaken = Utils.ZERO_DEC
          let totalStakeKairoValue = Utils.ZERO_DEC // total staked Kairo value modified by Utils.toKairoROI
          let totalStakeInvestmentValue = Utils.ZERO_DEC // the total value of staked tokens, denoted in Kairo

          // update kairo balances
          manager.kairoBalance = Utils.normalize(kairo.balanceOf(Address.fromString(manager.id)))
          manager.save()

          // basic orders
          for (let o = 0; o < manager.basicOrders.length; o++) {
            let order = BasicOrder.load(Utils.getArrItem<string>(manager.basicOrders, o))
            if (order.cycleNumber.equals(fund.cycleNumber)) {
              // update price
              if (!order.isSold) {
                order.sellPrice = Utils.getPriceOfToken(Address.fromString(order.tokenAddress), order.rawTokenAmount)
                order.save()
                // record stake value
                if (order.buyPrice.equals(Utils.ZERO_DEC)) {
                  totalStakeInvestmentValue = totalStakeInvestmentValue.plus(order.stake)
                  totalStakeKairoValue = totalStakeKairoValue.plus(order.stake)
                } else {
                  let investmentROI = order.sellPrice.minus(order.buyPrice).div(order.buyPrice)
                  let kairoROI = Utils.toKairoROI(investmentROI)
                  totalStakeInvestmentValue = totalStakeInvestmentValue.plus(order.stake.times(investmentROI.plus(Utils.ONE_DEC)))
                  totalStakeKairoValue = totalStakeKairoValue.plus(order.stake.times(kairoROI.plus(Utils.ONE_DEC)))
                }
              }
              // record risk
              let time: BigDecimal
              if (order.isSold) {
                time = order.sellTime.minus(order.buyTime).toBigDecimal()
              } else {
                time = block.timestamp.minus(order.buyTime).toBigDecimal()
              }
              riskTaken = riskTaken.plus(order.stake.times(time))
            }
          }

          // Compound orders
          for (let o = 0; o < manager.compoundOrders.length; o++) {
            let order = CompoundOrder.load(Utils.getArrItem<string>(manager.compoundOrders, o))
            // Ad hoc fix: sometimes sold compound order isn't registered by the event handler
            // So check the order's status from the contract
            let contract = CompoundOrderContract.bind(Address.fromString(order.orderAddress))
            if (contract.isSold() && !order.isSold && contract.outputAmount().gt(Utils.ZERO_INT)) {
              order.isSold = true
              order.sellTime = block.timestamp;
              order.outputAmount = Utils.normalize(contract.outputAmount())
              order.save()

              Utils.updateTotalFunds(context)
            }

            if (order.cycleNumber.equals(fund.cycleNumber) && !order.isSold) {
              order.collateralRatio = Utils.normalize(contract.getCurrentCollateralRatioInDAI())

              let currProfitObj = contract.getCurrentProfitInDAI() // value0: isNegative, value1: value
              order.currProfit = Utils.normalize(currProfitObj.value1.times(currProfitObj.value0 ? BigInt.fromI32(-1) : BigInt.fromI32(1)))

              order.currCollateral = Utils.normalize(contract.getCurrentCollateralInDAI())
              order.currBorrow = Utils.normalize(contract.getCurrentBorrowInDAI())
              order.currCash = Utils.normalize(contract.getCurrentCashInDAI())
              order.save()

              // record stake value
              if (order.collateralAmountInDAI.equals(Utils.ZERO_DEC)) {
                totalStakeInvestmentValue = totalStakeInvestmentValue.plus(order.stake)
                totalStakeKairoValue = totalStakeKairoValue.plus(order.stake)
              } else {
                let investmentROI = order.currProfit.div(order.collateralAmountInDAI)
                let kairoROI = Utils.toKairoROI(investmentROI)
                totalStakeInvestmentValue = totalStakeInvestmentValue.plus(order.stake.times(investmentROI.plus(Utils.ONE_DEC)))
                totalStakeKairoValue = totalStakeKairoValue.plus(order.stake.times(kairoROI.plus(Utils.ONE_DEC)))
              }
            }

            // record risk
            if (order.cycleNumber.equals(fund.cycleNumber)) {
              let time: BigDecimal
              if (order.isSold) {
                time = order.sellTime.minus(order.buyTime).toBigDecimal()
              } else {
                time = block.timestamp.minus(order.buyTime).toBigDecimal()
              }
              riskTaken = riskTaken.plus(order.stake.times(time))
            }
          }

          // risk taken
          manager.riskTaken = riskTaken

          // total stake value
          manager.kairoBalanceWithStake = totalStakeKairoValue.plus(manager.kairoBalance)

          manager.save()

          tentativeTotalInvestmentValueInKairo = tentativeTotalInvestmentValueInKairo.plus(manager.kairoBalance).plus(totalStakeInvestmentValue)
        }
      } else {
        tentativeTotalInvestmentValueInKairo = fund.kairoTotalSupply
      }

      // record AUM
      fund.aum = fund.totalFundsInDAI.times(tentativeTotalInvestmentValueInKairo).div(fund.kairoTotalSupply)
      // record Betoken Shares price
      if (fund.sharesTotalSupply.equals(Utils.ZERO_DEC)) {
        fund.sharesPrice = Utils.ONE_DEC
      } else {
        fund.sharesPrice = fund.aum.div(fund.sharesTotalSupply)
      }
    }

    // record history every 24 hours
    if (block.number.mod(Utils.RECORD_INTERVAL).isZero()) {
      log.info("Recording historical data for block: {}", [block.number.toString()])

      let aumDP = new DataPoint('aumHistory-' + block.number.toString())
      aumDP.timestamp = block.timestamp
      aumDP.value = fund.aum
      aumDP.save()
      let aumHistory = fund.aumHistory
      aumHistory.push(aumDP.id)
      fund.aumHistory = aumHistory

      let dp = new DataPoint('sharesPriceHistory-' + block.number.toString())
      dp.timestamp = block.timestamp
      dp.value = fund.sharesPrice
      dp.save()
      let sharesPriceHistory = fund.sharesPriceHistory
      sharesPriceHistory.push(dp.id)
      fund.sharesPriceHistory = sharesPriceHistory

      // record token prices
      for (let i = 0; i < KYBER_TOKENS.length; i++) {
        let token: TokenInfo = Utils.getArrItem<TokenInfo>(KYBER_TOKENS, i)
        let tokenPrice = new TokenPrice(token.address + '-' + block.timestamp.toString())
        tokenPrice.tokenAddress = token.address
        tokenPrice.tokenSymbol = token.symbol
        tokenPrice.priceInDAI = Utils.getPriceOfToken(Address.fromString(token.address), Utils.ZERO_INT)
        tokenPrice.timestamp = block.timestamp
        tokenPrice.save()
      }
    }

    fund.save()
  }
}