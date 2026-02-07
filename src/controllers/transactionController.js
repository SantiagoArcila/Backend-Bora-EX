import { UserModel } from "../models/userModel.js";
import { TransactionModel } from "../models/transactionModel.js";
import { LinkModel } from "../models/linkModel.js";
import { response } from "../helpers/Response.js";
import linkCtrl from "./linkController.js";

const transactionCtrl = {};

// Initialize users
const initializeUsers = async () => {
  try {
    // Delete all transactions
    await TransactionModel.deleteMany({});

    // Delete all links
    await LinkModel.deleteMany({});

    // Update all users
    await UserModel.updateMany(
      {},
      {
        $set: {
          balance: 0,
          value: 0,
          public_rate: 10,
          link_obligation: 0,
          link_income: 0,
          auxiliary: 0,
          trigger: 0,
          trxCount: 0,
          transactionHistory: [], // Clear transaction history
        },
      }
    );

    // Update admin user separately
    await UserModel.updateOne(
      { _id: "66e23b0b9d29581c2c6028dd" },
      {
        $set: {
          balance: 0,
          value: 0,
          public_rate: 10,
          link_obligation: 0,
          link_income: 0,
          auxiliary: 0,
          trigger: 2,
          trxCount: 0,
          transactionHistory: [], // Clear transaction history
        },
      }
    );
    console.log("Users initialized successfully.");
  } catch (error) {
    console.error(`Error initializing users: ${error.message}`);
  }
};

// Call initializeUsers to set initial values
// initializeUsers();

// Deposit Money
transactionCtrl.depositMoney = async (req, res) => {
  try {
    const { accountNumber, amount } = req.body;

    // Validate required fields
    if (!accountNumber || !amount) {
      return response(
        res,
        400,
        false,
        "",
        "Account number and amount are required"
      );
    }

    // Ensure amount is a number
    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount)) {
      return response(res, 400, false, "", "Invalid deposit amount");
    }

    // Find the user by account number
    const user = await UserModel.findOne({ accountNumber });

    if (!user) {
      return response(res, 404, false, "", "User not found");
    }

    // Update user's balance and value
    user.balance = (user.balance || 0) + depositAmount;
    user.value = await transactionCtrl.calculateValue(user); // Set value to match the new balance

    // Save the updated user
    await user.save();

    // Return success response
    return response(res, 200, true, user, "Deposit successful");
  } catch (error) {
    console.error(`Error depositing money: ${error.message}`);
    return response(res, 500, false, null, error.message);
  }
};

// Withdraw Money
transactionCtrl.withdrawMoney = async (req, res) => {
  try {
    const { accountNumber, amount } = req.body;

    // Validate required fields
    if (!accountNumber || !amount) {
      return response(
        res,
        400,
        false,
        "",
        "Account number and amount are required"
      );
    }

    // Check if amount is a positive number
    if (amount <= 0) {
      return response(res, 400, false, "", "Amount must be greater than zero");
    }

    // Find the user by account number
    const user = await UserModel.findOne({ accountNumber });

    if (!user) {
      return response(res, 404, false, "", "User not found");
    }

    // Check if user has sufficient balance
    if (user.balance < amount) {
      return response(res, 400, false, "", "Insufficient balance");
    }

    // Update user's balance and value
    user.balance -= amount;
    user.value = await transactionCtrl.calculateValue(user); // Set value to match the new balance

    // Save the updated user
    await user.save();

    // Return success response
    return response(res, 200, true, user, "Withdrawal successful");
  } catch (error) {
    console.error(`Error withdrawing money: ${error.message}`);
    return response(res, 500, false, null, error.message);
  }
};

// Create Transaction
transactionCtrl.createTransaction = async (req, res) => {
  try {
    const {
      senderAccountNumber,
      receiverAccountNumber,
      amount,
      feeRate,
    } = req.body;

    // Validate required fields
    if (
      !senderAccountNumber ||
      !receiverAccountNumber ||
      !amount ||
      feeRate === undefined
    ) {
      return response(res, 400, false, "", "All fields are required");
    }

    const sender = await UserModel.findOne({
      accountNumber: senderAccountNumber,
    });
    const receiver = await UserModel.findOne({
      accountNumber: receiverAccountNumber,
    });

    if (!sender || !receiver) {
      return response(res, 404, false, "", "Sender or receiver not found");
    }

    // Calculate fee
    const fee = feeRate > 0 ? amount * (feeRate / 100) : 0;

    // Check for sufficient balance
    if (sender.balance < amount + fee) {
      return response(res, 400, false, "", "Insufficient balance");
    }

    if (feeRate === 0) {
      // If feeRate is 0, process transaction without links
      sender.balance -= amount;
      receiver.balance += amount;
    } else {
      // If feeRate is greater than 0, process transaction with links
      sender.balance -= amount + fee;
      receiver.balance += amount;

      // Fetch the admin user
      const adminId = "66e23b0b9d29581c2c6028dd";
      const admin = await UserModel.findById(adminId);

      if (admin) {
        // Update sender-admin link
        await linkCtrl.updateLink({
          senderName: sender.name,
          receiverName: admin.name,
          senderId: sender._id,
          receiverId: admin._id,
          feeRate: feeRate,
          amount: amount,
        });

        // Update admin-receiver link (change from receiver-admin to admin-receiver)
        await linkCtrl.updateLink({
          senderName: admin.name,
          receiverName: receiver.name,
          senderId: admin._id,
          receiverId: receiver._id,
          feeRate: feeRate,
          amount: amount - fee,
        });

        // Update admin account for fee
        admin.auxiliary += fee*0.9;
        admin.balance += fee*0.1;
        admin.trxCount += 1;
        admin.value = await transactionCtrl.calculateValue(admin);
        await admin.save();

        console.log(
          `Updated admin ${admin.name}: Auxiliary = ${admin.auxiliary}, Transaction Count = ${admin.trxCount}`
        );
      }
    }

    // Create transaction
    const transaction = await TransactionModel.create({
      receiveraccountNumber: receiver.accountNumber,
      senderaccountNumber: sender.accountNumber,
      senderName: sender.name,
      receiverName: receiver.name,
      senderId: sender._id,
      receiverId: receiver._id,
      amount: amount,
      fee_rate: feeRate,
      initialSenderBalance: sender.balance + amount + fee,
      finalSenderBalance: sender.balance,
    });

    // Calculate value for sender and receiver
    sender.value = await transactionCtrl.calculateValue(sender);
    receiver.value = await transactionCtrl.calculateValue(receiver);

    // Calculate PR for sender if feeRate is greater than 0
    if (feeRate > 0) {
      sender.public_rate = await transactionCtrl.calculatePR(sender);
    }

    // Save sender and receiver transaction history
    sender.transactionHistory.push(transaction._id);
    await sender.save();
    receiver.transactionHistory.push(transaction._id);
    await receiver.save();

    // Clear pending distributions if necessary
    await transactionCtrl.clearPendingDistributions();

    // Return success response
    return response(
      res,
      200,
      true,
      transaction,
      "Transaction created successfully"
    );
  } catch (error) {
    console.error(`Error performing transaction: ${error.message}`);
    return response(res, 500, false, null, error.message);
  }
};

// Calculate public rate for a user
transactionCtrl.calculatePR = async (user) => {
  const totalAmount = await LinkModel.aggregate([
    { $match: { senderId: user._id } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  const sumProd = await LinkModel.aggregate([
    { $match: { senderId: user._id } },
    {
      $group: {
        _id: null,
        total: { $sum: { $multiply: ["$amount", "$feeRate"] } },
      },
    },
  ]);

  const totalAmountValue = totalAmount[0]?.total || 0;
  const sumProdValue = sumProd[0]?.total || 0;

  if (totalAmountValue === 0) {
    return user.public_rate;
  } else {
    return sumProdValue / totalAmountValue;
  }
};

// Clear pending distributions
transactionCtrl.clearPendingDistributions = async () => {
  try {
    const users = await UserModel.find({});

    // Log the users obtained from the query
    console.log("All users:", users);

    const usersWithPendingDistributions = users.filter(
      (user) => user.trxCount >= user.trigger + 1
    );

    // Log the users that meet the condition
    console.log(
      "Users with pending distributions:",
      usersWithPendingDistributions
    );

    for (const user of usersWithPendingDistributions) {
      await transactionCtrl.Distribute(user);
    }
  } catch (error) {
    console.error(`Error clearing pending distributions: ${error.message}`);
  }
};

// Distribute function (to be implemented as needed)
transactionCtrl.Distribute = async (user) => {
  try {
    console.log("Distributing for user:", user._id);

    const distributionAmount = user.auxiliary;

    // Identify all links where the user is the receiver
    const links = await LinkModel.find({ receiverId: user._id });

    let totalPR = 0;
    const participants = [];

    // Sum up PR values for each participant
    for (const link of links) {
      const participant = await UserModel.findById(link.senderId);
      if (participant.balance < participant.value) {
        totalPR += participant.public_rate;
        console.log(participant.public_rate);
        participants.push(participant);
      }
    }

    // Check if the user should also be considered as a participant
    if (user.balance < user.value) {
      participants.push(user);
      totalPR += user.public_rate;
    }

    // Calculate and distribute shares for each participant
    for (const participant of participants) {
      const share = (distributionAmount * participant.public_rate) / totalPR;

      // Log the share distribution and create the transaction
      console.log(`${user.name}, to ${participant.name}, ${share}`);
      await transactionCtrl.clearteDistributionTransaction(
        user,
        participant,
        share
      );
    }

    // Reset transaction count (trxCount) to zero after distribution
    user.trxCount = 0;
    await user.save();
  } catch (error) {
    console.error(`Error distributing for user: ${user._id}`, error.message);
  }
};

// Create a distribution transaction
transactionCtrl.clearteDistributionTransaction = async (
  distributor,
  participant,
  share
) => {
  try {
    // Check if the distributor and participant are the same
    if (distributor._id.equals(participant._id)) {
      // If the distributor is the same as the participant
      participant.balance += share;
      participant.auxiliary -= share;

      // Save the participant's updated details
      await participant.save();

      console.log(
        `Updated ${participant.name}: Balance = ${participant.balance}, Auxiliary = ${participant.auxiliary}`
      );
    } else {
      // Get the link value (assuming a link exists between participant and distributor)
      const link = await LinkModel.findOne({
        senderId: participant._id,
        receiverId: distributor._id,
      });

      // Check if the link exists and get its value
      if (link) {
        let linkValue = link.amount;

        if (share >= linkValue) {
          // Adjust share if it exceeds the link value
          share = linkValue;
          participant.balance += share;
          // participant.trxCount += 1;
          distributor.auxiliary -= share;

          // Save updated participant and distributor details
          await participant.save();
          await distributor.save();

          console.log(
            `Updated ${participant.name}: Auxiliary = ${participant.auxiliary}, Transaction Count = ${participant.trxCount}`
          );
          console.log(
            `Updated ${distributor.name}: Auxiliary = ${distributor.auxiliary}`
          );

          // Delete the link if it is fully utilized
          await LinkModel.deleteOne({ _id: link._id });

          // Decrement the trigger for distributors except the specific admin ID
          // if (!distributor._id.equals("66e23b0b9d29581c2c6028dd")) {
          //   distributor.trigger -= 1;
          //   await distributor.save();
          //   console.log(
          //     `Updated ${distributor.name}: Trigger = ${distributor.trigger}`
          //   );
          // } else {
          //   console.log(`Admin ${distributor.name} trigger not decremented.`);
          // }

          // Recalculate the public rate for the participant
          await transactionCtrl.calculatePR(participant);
        } else {
          // Update link if share is less than the link value
          participant.balance += share;
          // participant.trxCount += 1;
          distributor.auxiliary -= share;

          // Save updated participant and distributor details
          await participant.save();
          await distributor.save();

          console.log(
            `Updated ${participant.name}: Auxiliary = ${participant.auxiliary}, Transaction Count = ${participant.trxCount}`
          );
          console.log(
            `Updated ${distributor.name}: Auxiliary = ${distributor.auxiliary}`
          );

          // Update the link with reduced amount and rate set to 0
          await LinkModel.updateOne(
            { _id: link._id },
            { $inc: { amount: -share } }
          );

          console.log(
            `Updated link between ${participant.name} and ${
              distributor.name
            }: Remaining Amount = ${link.amount - share}`
          );
        }
      } else {
        console.log(
          `No link found between ${participant.name} and ${distributor.name}`
        );
      }
    }
  } catch (error) {
    console.error("Error creating distribution transaction:", error.message);
  }
};

// Calculate value for a user
transactionCtrl.calculateValue = async (user) => {
  const linkObligation = await LinkModel.aggregate([
    { $match: { senderId: user._id } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  const linkIncome = await LinkModel.aggregate([
    { $match: { receiverId: user._id } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  const totalObligation = linkObligation[0]?.total || 0;
  const totalIncome = linkIncome[0]?.total || 0;

  return user.balance + user.auxiliary + totalObligation - totalIncome;
};

// Get all transactions
transactionCtrl.getAllTransactions = async (req, res) => {
  try {
    const transactions = await TransactionModel.find()
      .populate("senderId", "name")
      .populate("receiverId", "name");

    return response(res, 200, true, transactions, "List of all transactions");
  } catch (error) {
    console.error(`Error retrieving transactions: ${error.message}`);
    return response(res, 500, false, "", "Error retrieving transactions");
  }
};

// Get Transaction by ID
transactionCtrl.getTransactionById = async (req, res) => {
  try {
    const { transactionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(transactionId)) {
      return response(res, 400, false, "", "Invalid transaction ID format");
    }
    const transaction = await TransactionModel.findById(transactionId).populate(
      "senderId receiverId"
    );

    if (!transaction) {
      return response(res, 404, false, "", "Transaction not found");
    }

    return response(res, 200, true, transaction, "Transaction found");
  } catch (error) {
    return response(res, 500, false, null, error.message);
  }
};

// Get transaction history for a user
transactionCtrl.getTransactionHistory = async (req, res) => {
  try {
    const { userId } = req.params;

    // Find user by account number
    const user = await UserModel.findById(userId).populate('transactionHistory');

    if (!user) {
      return response(res, 404, false, "", "User not found");
    }

    // Return the transaction history
    return response(res, 200, true, user.transactionHistory, "Transaction history obtained successfully");
  } catch (error) {
    console.error(`Error retrieving transaction history: ${error.message}`);
    return response(res, 500, false, null, "Error retrieving transaction history");
  }
};

export default transactionCtrl;

