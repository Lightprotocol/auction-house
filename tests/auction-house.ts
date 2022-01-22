import * as assert from "assert";
import * as anchor from "../../../project-serum/anchor/ts";
import {
  Provider,
  Program,
  Wallet,
  BN,
  getProvider,
} from "../../../project-serum/anchor/ts";
import {
  Transaction,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { u64, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as metaplex from "@metaplex/js";
import { IDL, AuctionHouse } from "../target/types/auction_house";
const MetadataDataData = metaplex.programs.metadata.MetadataDataData;
const CreateMetadata = metaplex.programs.metadata.CreateMetadata;

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const AUCTION_HOUSE_PROGRAM_ID = new PublicKey(
  "hausS13jsjafwWwGqZTUQRmWyvyxn9EQpqMwV1PBBmk"
);

// Mint address for native SOL token accounts.
//
// The program uses this when one wants to pay with native SOL vs an SPL token.
const NATIVE_SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

describe("auction-house", () => {
  anchor.setProvider(Provider.env());

  // Clients.
  let authorityClient: Program<AuctionHouse>; // Reprents the exchange authority.
  let sellerClient: Program<AuctionHouse>; // Represents the seller.
  let buyerClient: Program<AuctionHouse>; // Represents the buyer.
  let nftMintClient: Token; // Represents the NFT to be traded.

  // Seeds constants.
  const PREFIX = Buffer.from("auction_house");
  const FEE_PAYER = Buffer.from("fee_payer");
  const TREASURY = Buffer.from("treasury");
  const SIGNER = Buffer.from("signer");

  // Constant accounts.
  // @ts-ignore
  const authorityKeypair = getProvider().wallet.payer;
  const authority = getProvider().wallet.publicKey;
  const feeWithdrawalDestination = authority;
  const treasuryWithdrawalDestination = authority;
  const treasuryWithdrawalDestinationOwner = authority;
  const treasuryMint = NATIVE_SOL_MINT;
  const tokenProgram = TOKEN_PROGRAM_ID;
  const systemProgram = SystemProgram.programId;

  // Uninitialized constant accounts.
  let metadata: PublicKey;
  let auctionHouse: PublicKey;
  let auctionHouseFeeAccount: PublicKey;
  let programAsSignerBump: number;
  let auctionHouseTreasuryBump: number;
  let auctionHouseFeeAccountBump: number;
  let bump: number;

  // Buyer specific vars.
  const buyerWallet = Keypair.generate();
  let buyerTokenAccount: PublicKey;
  let buyerEscrow: PublicKey;
  let buyerEscrowBump: number;

  // Seller specific vars.
  const sellerWallet = Keypair.generate();
  let sellerTokenAccount: PublicKey;

  it("Creates an NFT mint", async () => {
    // Create the mint.
    nftMintClient = await Token.createMint(
      getProvider().connection,
      // @ts-ignore
      getProvider().wallet.payer,
      getProvider().wallet.publicKey,
      null,
      6,
      tokenProgram
    );

    // Create the metadata.
    const [_metadata] = await PublicKey.findProgramAddress(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        nftMintClient.publicKey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );
    metadata = _metadata;
    const tx = new CreateMetadata(
      { feePayer: getProvider().wallet.publicKey },
      {
        metadata,
        metadataData: new MetadataDataData({
          name: "test-nft",
          symbol: "TEST",
          uri: "https://nothing.com",
          sellerFeeBasisPoints: 1,
          creators: null,
        }),
        updateAuthority: getProvider().wallet.publicKey,
        mint: nftMintClient.publicKey,
        mintAuthority: getProvider().wallet.publicKey,
      }
    );
    await getProvider().send(tx);
  });

  it("Creates token accounts for the NFT", async () => {
    // Create token accounts for the mint.
    buyerTokenAccount = await nftMintClient.createAssociatedTokenAccount(
      buyerWallet.publicKey
    );
    sellerTokenAccount = await nftMintClient.createAssociatedTokenAccount(
      sellerWallet.publicKey
    );

    // Initialize the seller's account with a single token.
    await nftMintClient.mintTo(
      sellerTokenAccount,
      getProvider().wallet.publicKey,
      [],
      1
    );
  });

  it("Creates auction house program clients representing the buyer and seller", async () => {
    authorityClient = new Program<AuctionHouse>(
      IDL,
      AUCTION_HOUSE_PROGRAM_ID,
      getProvider()
    );
    sellerClient = new Program<AuctionHouse>(
      IDL,
      AUCTION_HOUSE_PROGRAM_ID,
      new Provider(
        getProvider().connection,
        new Wallet(sellerWallet),
        Provider.defaultOptions()
      )
    );
    buyerClient = new Program<AuctionHouse>(
      IDL,
      AUCTION_HOUSE_PROGRAM_ID,
      new Provider(
        getProvider().connection,
        new Wallet(buyerWallet),
        Provider.defaultOptions()
      )
    );
  });

  it("Initializes constants", async () => {
    const [_auctionHouse, _bump] = await PublicKey.findProgramAddress(
      [PREFIX, authority.toBuffer(), treasuryMint.toBuffer()],
      AUCTION_HOUSE_PROGRAM_ID
    );
    const [
      _auctionHouseFeeAccount,
      _auctionHouseFeeAccountBump,
    ] = await PublicKey.findProgramAddress(
      [PREFIX, _auctionHouse.toBuffer(), FEE_PAYER],
      AUCTION_HOUSE_PROGRAM_ID
    );
    const [, _auctionHouseTreasuryBump] = await PublicKey.findProgramAddress(
      [PREFIX, _auctionHouse.toBuffer(), TREASURY],
      AUCTION_HOUSE_PROGRAM_ID
    );
    const [_buyerEscrow, _buyerEscrowBump] = await PublicKey.findProgramAddress(
      [PREFIX, _auctionHouse.toBuffer(), buyerWallet.publicKey.toBuffer()],
      AUCTION_HOUSE_PROGRAM_ID
    );
    const [
      _programAsSigner,
      _programAsSignerBump,
    ] = await PublicKey.findProgramAddress(
      [PREFIX, SIGNER],
      AUCTION_HOUSE_PROGRAM_ID
    );

    auctionHouse = _auctionHouse;
    bump = _bump;
    auctionHouseFeeAccount = _auctionHouseFeeAccount;
    auctionHouseFeeAccountBump = _auctionHouseFeeAccountBump;
    auctionHouseTreasuryBump = _auctionHouseTreasuryBump;
    buyerEscrow = _buyerEscrow;
    buyerEscrowBump = _buyerEscrowBump;
    programAsSignerBump = _programAsSignerBump;
  });

  it("Funds the buyer with lamports so that it can bid", async () => {
    const tx = new Transaction();
    tx.add(
      SystemProgram.transfer({
        fromPubkey: authority,
        toPubkey: buyerWallet.publicKey,
        lamports: 20 * 10 ** 9,
      })
    );
    tx.add(
      SystemProgram.transfer({
        fromPubkey: authority,
        toPubkey: sellerWallet.publicKey,
        lamports: 20 * 10 ** 9,
      })
    );
    tx.add(
      SystemProgram.transfer({
        fromPubkey: authority,
        toPubkey: auctionHouseFeeAccount,
        lamports: 100 * 10 ** 9,
      })
    );
    const txSig = await getProvider().send(tx);
    console.log("fund buyer:", txSig);
  });

  it("Creates an auction house", async () => {
    const sellerFeeBasisPoints = 1;
    const requiresSignOff = true;
    const canChangeSalePrice = true;

    const txSig = await authorityClient.methods
      .createAuctionHouse(
        bump,
        auctionHouseFeeAccountBump,
        auctionHouseTreasuryBump,
        sellerFeeBasisPoints,
        requiresSignOff,
        canChangeSalePrice
      )
      .accounts({
        treasuryMint,
        authority,
        feeWithdrawalDestination,
        treasuryWithdrawalDestination,
        treasuryWithdrawalDestinationOwner,
      })
      .rpc();

    console.log("createAuctionHouse:", txSig);
  });

  it("Deposits into an escrow account", async () => {
    const amount = new BN(10 * 10 ** 9);

    const txSig = await buyerClient.methods
      .deposit(buyerEscrowBump, amount)
      .accounts({
        paymentAccount: buyerWallet.publicKey,
        transferAuthority: buyerWallet.publicKey,
        treasuryMint,
        authority,
      })
      .signers([authorityKeypair])
      .rpc();

    console.log("deposit:", txSig);
  });

  it("Withdraws from an escrow account", async () => {
    const amount = new BN(10 * 10 ** 9);
    const txSig = await buyerClient.methods
      .withdraw(buyerEscrowBump, amount)
      .accounts({
        wallet: buyerWallet.publicKey,
        receiptAccount: buyerWallet.publicKey,
        treasuryMint,
        authority,
      })
      .signers([authorityKeypair])
      .rpc();

    console.log("withdraw:", txSig);
  });

  it("Posts an offer", async () => {
    const buyerPrice = new u64(2 * 10 ** 9);
    const tokenSize = new u64(1);
    const zero = new u64(0);
    const [, sellerTradeStateBump] = await PublicKey.findProgramAddress(
      [
        PREFIX,
        sellerWallet.publicKey.toBuffer(),
        auctionHouse.toBuffer(),
        sellerTokenAccount.toBuffer(),
        treasuryMint.toBuffer(),
        nftMintClient.publicKey.toBuffer(),
        buyerPrice.toBuffer(),
        tokenSize.toBuffer(),
      ],
      AUCTION_HOUSE_PROGRAM_ID
    );
    const [, freeSellerTradeStateBump] = await PublicKey.findProgramAddress(
      [
        PREFIX,
        sellerWallet.publicKey.toBuffer(),
        auctionHouse.toBuffer(),
        sellerTokenAccount.toBuffer(),
        treasuryMint.toBuffer(),
        nftMintClient.publicKey.toBuffer(),
        zero.toBuffer(),
        tokenSize.toBuffer(),
      ],
      AUCTION_HOUSE_PROGRAM_ID
    );
    const txSig = await sellerClient.methods
      .sell(
        sellerTradeStateBump,
        freeSellerTradeStateBump,
        programAsSignerBump,
        buyerPrice,
        tokenSize
      )
      .accounts({
        wallet: sellerWallet.publicKey,
        tokenAccount: sellerTokenAccount,
        metadata,
        authority,
        treasuryMint,
      })
      .signers([authorityKeypair])
      .rpc();

    console.log("sell:", txSig);
  });

  it("Cancels an offer", async () => {
    const buyerPrice = new u64(2 * 10 ** 9);
    const tokenSize = new u64(1);
    const txSig = await sellerClient.methods
      .cancel(buyerPrice, tokenSize)
      .accounts({
        wallet: sellerWallet.publicKey,
        tokenAccount: sellerTokenAccount,
        tokenMint: nftMintClient.publicKey,
        authority,
        treasuryMint,
      })
      .signers([authorityKeypair])
      .rpc();
    console.log("cancel:", txSig);
  });

  it("Posts an offer (again)", async () => {
    const buyerPrice = new u64(2 * 10 ** 9);
    const tokenSize = new u64(1);
    const zero = new u64(0);
    const [, sellerTradeStateBump] = await PublicKey.findProgramAddress(
      [
        PREFIX,
        sellerWallet.publicKey.toBuffer(),
        auctionHouse.toBuffer(),
        sellerTokenAccount.toBuffer(),
        treasuryMint.toBuffer(),
        nftMintClient.publicKey.toBuffer(),
        buyerPrice.toBuffer(),
        tokenSize.toBuffer(),
      ],
      AUCTION_HOUSE_PROGRAM_ID
    );
    const [, freeSellerTradeStateBump] = await PublicKey.findProgramAddress(
      [
        PREFIX,
        sellerWallet.publicKey.toBuffer(),
        auctionHouse.toBuffer(),
        sellerTokenAccount.toBuffer(),
        treasuryMint.toBuffer(),
        nftMintClient.publicKey.toBuffer(),
        zero.toBuffer(),
        tokenSize.toBuffer(),
      ],
      AUCTION_HOUSE_PROGRAM_ID
    );
    const txSig = await sellerClient.methods
      .sell(
        sellerTradeStateBump,
        freeSellerTradeStateBump,
        programAsSignerBump,
        buyerPrice,
        tokenSize
      )
      .accounts({
        wallet: sellerWallet.publicKey,
        tokenAccount: sellerTokenAccount,
        metadata,
        authority,
        treasuryMint,
      })
      .signers([authorityKeypair])
      .rpc();

    console.log("sell:", txSig);
  });

  it("Posts a bid", async () => {
    const buyerPrice = new u64(2 * 10 ** 9);
    const tokenSize = new u64(1);
    const [
			,
      buyerTradeStateBump,
    ] = await PublicKey.findProgramAddress(
      [
        PREFIX,
        buyerWallet.publicKey.toBuffer(),
        auctionHouse.toBuffer(),
        sellerTokenAccount.toBuffer(),
        treasuryMint.toBuffer(),
        nftMintClient.publicKey.toBuffer(),
        buyerPrice.toBuffer(),
        tokenSize.toBuffer(),
      ],
      AUCTION_HOUSE_PROGRAM_ID
    );
    const txSig = await buyerClient.methods
      .buy(buyerTradeStateBump, buyerEscrowBump, buyerPrice, tokenSize)
      .accounts({
        wallet: buyerWallet.publicKey,
        paymentAccount: buyerWallet.publicKey,
        transferAuthority: buyerWallet.publicKey,
        treasuryMint,
        tokenAccount: sellerTokenAccount,
        metadata,
        authority,
      })
      .signers([authorityKeypair])
      .rpc();

    console.log("buy:", txSig);
  });

  it("Executes a trades", async () => {
    // Before state.
    const beforeEscrowState = await authorityClient.provider.connection.getAccountInfo(
      buyerEscrow
    );
    const beforeSeller = await authorityClient.provider.connection.getAccountInfo(
      sellerWallet.publicKey
    );

    // Execute trade.
    const buyerPrice = new u64(2 * 10 ** 9);
    const tokenSize = new u64(1);
    const zero = new u64(0);
    const [, freeSellerTradeStateBump] = await PublicKey.findProgramAddress(
      [
        PREFIX,
        sellerWallet.publicKey.toBuffer(),
        auctionHouse.toBuffer(),
        sellerTokenAccount.toBuffer(),
        treasuryMint.toBuffer(),
        nftMintClient.publicKey.toBuffer(),
        zero.toBuffer(),
        tokenSize.toBuffer(),
      ],
      AUCTION_HOUSE_PROGRAM_ID
    );
    const txSig = await authorityClient.methods
      .executeSale(
        buyerEscrowBump,
        freeSellerTradeStateBump,
        programAsSignerBump,
        buyerPrice,
        tokenSize
      )
      .accounts({
        buyer: buyerWallet.publicKey,
        seller: sellerWallet.publicKey,
        tokenAccount: sellerTokenAccount,
        tokenMint: nftMintClient.publicKey,
        metadata,
        treasuryMint,
        escrowPaymentAccount: buyerEscrow,
        sellerPaymentReceiptAccount: sellerWallet.publicKey,
        buyerReceiptTokenAccount: buyerTokenAccount,
        authority,
      })
      .rpc();

    console.log("executeSale:", txSig);

    // After state.
    const afterEscrowState = await authorityClient.provider.connection.getAccountInfo(
      buyerEscrow
    );
    const afterSeller = await authorityClient.provider.connection.getAccountInfo(
      sellerWallet.publicKey
    );

    // Assertions.
    assert.ok(afterEscrowState === null);
    assert.ok(beforeEscrowState.lamports === 2 * 10 ** 9);
    assert.ok(1999800000.0 === afterSeller.lamports - beforeSeller.lamports); // 1bp fee.
  });

  it("Withdraws from the fee account", async () => {
    const txSig = await authorityClient.methods
      .withdrawFromFee(new u64(1))
      .accounts({
        authority,
        treasuryMint,
        feeWithdrawalDestination,
        auctionHouseFeeAccount,
        auctionHouse,
        systemProgram,
      })
      .rpc();
    console.log("withdrawFromFee:", txSig);
  });

  it("Withdraws from the treasury account", async () => {
    const txSig = await authorityClient.methods
      .withdrawFromTreasury(new u64(1))
      .accounts({
        treasuryMint,
        authority,
        treasuryWithdrawalDestination,
      })
      .rpc();
    console.log("txSig:", txSig);
  });

  it("Updates an auction house", async () => {
    const sellerFeeBasisPoints = 2;
    const requiresSignOff = true;
    const canChangeSalePrice = null;
    const tx = new Transaction();
    tx.add(
      await authorityClient.methods
        .updateAuctionHouse(
          sellerFeeBasisPoints,
          requiresSignOff,
          canChangeSalePrice
        )
        .accounts({
          treasuryMint,
          payer: authority,
          authority,
          newAuthority: authority,
          feeWithdrawalDestination,
          treasuryWithdrawalDestination,
          treasuryWithdrawalDestinationOwner,
        })
        .instruction()
    );

    const txSig = await authorityClient.provider.send(tx);
    console.log("updateAuctionHouse:", txSig);

    const newAh = await authorityClient.account.auctionHouse.fetch(
      auctionHouse
    );
    assert.ok(newAh.sellerFeeBasisPoints === 2);
  });
});
