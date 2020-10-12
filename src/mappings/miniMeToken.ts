import { Transfer as TransferEvent } from "../../generated/templates/MiniMeToken/MiniMeToken"
import { MiniMeToken } from '../../generated/templates/MiniMeToken/MiniMeToken'
import { PeakDeFiFund } from '../../generated/templates/PeakDeFiFund/PeakDeFiFund'
import { Investor } from "../../generated/schema"
import * as Utils from '../utils'

// token transfer handler

export function handleTokenTransfer(event: TransferEvent): void {
  let contract = MiniMeToken.bind(event.address)
  let fundContract = PeakDeFiFund.bind(contract.owner())
  let fundID = fundContract.proxyAddr().toHex()
  if (contract.symbol().includes("BTKS")) {
    let to = event.params._to
    let investor = Investor.load(fundID + '-' + to.toHex())
    if (investor == null) {
      // create new investor entity
      investor = new Investor(to.toHex())
      investor.depositWithdrawHistory = new Array<string>()
      investor.fund = fundID
      investor.address = to.toHex()
    }
    // update balances
    investor.sharesBalance = Utils.normalize(contract.balanceOf(to))
    investor.save()

    let from = event.params._from
    let sender = Investor.load(fundID + '-' + from.toHex())
    if (sender == null) {
      // create new investor entity
      sender = new Investor(from.toHex())
      sender.depositWithdrawHistory = new Array<string>()
      sender.fund = fundID
      sender.address = from.toHex()
    }
    // update balances
    sender.sharesBalance = Utils.normalize(contract.balanceOf(from))
    sender.save()
  }
}