import {
  PeakDeFiFund
} from "../../generated/templates/PeakDeFiFund/PeakDeFiFund"
import {
  UpdatedFundAddress as UpdatedFundAddressEvent
} from "../../generated/templates/PeakDeFiProxy/PeakDeFiProxy"
import {
  Fund
} from "../../generated/schema"
import {
  MiniMeToken as MiniMeTokenTemplate,
  PeakDeFiFund as PeakDeFiFundTemplate
} from '../../generated/templates'
import { MiniMeToken } from '../../generated/templates/MiniMeToken/MiniMeToken'
import { BigDecimal, Address, BigInt, DataSourceContext } from '@graphprotocol/graph-ts'

import * as Utils from '../utils'

// init fund handler

export function handleUpdatedFundAddress(event: UpdatedFundAddressEvent): void {
  // initialize fund entity
  let fundID = event.address.toHex()
  let fund_entity = Fund.load(fundID)
  if (fund_entity == null) {
    fund_entity = new Fund(fundID)
    let fund = PeakDeFiFund.bind(event.params._newFundAddr)
    let reptoken = MiniMeToken.bind(fund.controlTokenAddr())
    let shares = MiniMeToken.bind(fund.shareTokenAddr())
    fund_entity.totalFundsInUSDC = Utils.normalize(fund.totalFundsInUSDC())
    fund_entity.totalFundsAtPhaseStart = fund_entity.totalFundsInUSDC
    fund_entity.reptokenPrice = Utils.normalize(fund.reptokenPrice())
    fund_entity.reptokenTotalSupply = Utils.normalize(reptoken.totalSupply())
    if (shares.totalSupply().equals(Utils.ZERO_INT)) {
      fund_entity.sharesPrice = BigDecimal.fromString('1')
    } else {
      fund_entity.sharesPrice = fund_entity.totalFundsInUSDC.div(Utils.normalize(shares.totalSupply()))
    }
    fund_entity.sharesTotalSupply = Utils.normalize(shares.totalSupply())
    fund_entity.sharesPriceHistory = new Array<string>()
    fund_entity.aum = fund_entity.totalFundsInUSDC
    fund_entity.aumHistory = new Array<string>()
    fund_entity.cycleTotalCommission = Utils.ZERO_DEC
    fund_entity.managers = new Array<string>()
    fund_entity.cycleNumber = fund.cycleNumber()
    fund_entity.cyclePhase = Utils.CyclePhase[fund.cyclePhase()]
    fund_entity.startTimeOfCyclePhase = Utils.ZERO_INT
    fund_entity.phaseLengths = fund.getPhaseLengths()
    fund_entity.cycleROIHistory = new Array<BigDecimal>();
    fund_entity.versionNum = Utils.ZERO_INT
    MiniMeTokenTemplate.create(fund.shareTokenAddr())
  } else {
    fund_entity.versionNum = fund_entity.versionNum.plus(BigInt.fromI32(1))
  }

  fund_entity.address = event.params._newFundAddr.toHex()
  fund_entity.lastProcessedBlock = event.block.number
  fund_entity.hasFinalizedNextVersion = false
  fund_entity.nextVersion = ""
  /*fund_entity.upgradeVotingActive = false
  fund_entity.proposers = new Array<string>()
  fund_entity.candidates = new Array<string>()
  fund_entity.forVotes = new Array<BigDecimal>()
  fund_entity.againstVotes = new Array<BigDecimal>()
  fund_entity.upgradeSignalStrength = Utils.ZERO_DEC*/
  fund_entity.save()

  let context = new DataSourceContext()
  context.setString('ID', fundID)
  PeakDeFiFundTemplate.createWithContext(event.params._newFundAddr, context)
}
