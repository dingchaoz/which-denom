import axios from "axios";

type Coin = {
  denom: string;
  amount: number;
};

async function queryGasPrices(): Promise<Coin[]> {
  type GasPricesResponse = { [key: string]: string };
  const { data } = await axios.get<GasPricesResponse>("https://fcd.terra.dev/v1/txs/gas_prices");
  return Object.entries(data).map(([denom, amount]) => {
    return {
      denom,
      amount: parseFloat(amount),
    };
  });
}

async function querySwapReturns(ulunaOfferAmount: number, denoms: string[]): Promise<Coin[]> {
  type MantleResponse = {
    data: {
      [key: string]: {
        Result: {
          Amount: string;
        };
      };
    };
  };
  const generateQuery = (denom: string) => `
    ${denom}: MarketSwap(OfferCoin: "${ulunaOfferAmount}uluna", AskDenom: "${denom}") {
      Result {
        Amount
      }
    }
  `;
  const query = `
    query {
      ${denoms
        .filter((denom) => denom != "uluna")
        .map(generateQuery)
        .join("\n")}
    }
  `;
  const { data } = await axios.post<MantleResponse>("https://mantle.terra.dev/", { query });
  return denoms.map((denom) => {
    return {
      denom,
      amount: denom === "uluna" ? ulunaOfferAmount : parseInt(data.data[denom].Result.Amount),
    };
  });
}

// https://stackoverflow.com/questions/2901102/how-to-print-a-number-with-commas-as-thousands-separators-in-javascript
function formatInteger(integer: number, separator = '<span style="margin-right: 5px;"></span>') {
  return integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

function formatPercent(decimal: number) {
  return (decimal >= 0 ? "+" : "−") + (100 * Math.abs(decimal)).toFixed(1) + "%";
}

const ulunaOfferAmountInput = document.getElementById("ulunaOfferAmountInput") as HTMLInputElement;
const submitBtn = document.getElementById("submitBtn") as HTMLButtonElement;
const statusContainer = document.getElementById("statusContainer") as HTMLDivElement;
const tableContainer = document.getElementById("tableContainer") as HTMLDivElement;

submitBtn.addEventListener("click", async () => {
  const ulunaOfferAmount = parseInt(ulunaOfferAmountInput.value);

  // Query gas prices
  statusContainer.innerHTML = "querying gas prices... ";
  const gasPrices = await queryGasPrices();
  statusContainer.innerHTML += "done!<br />";
  console.log("gasPrices:", gasPrices);

  // Query swap returns
  statusContainer.innerHTML += "querying exchange rates... ";
  const denoms = gasPrices.map((coin) => coin.denom);
  const swapReturns = await querySwapReturns(ulunaOfferAmount, denoms);
  statusContainer.innerHTML += "done!<br />";
  console.log("swapReturns:", swapReturns);

  // Compute gas units purchasable by the swap returns and sort descendingly
  statusContainer.innerHTML += "computing results... ";
  const results = denoms
    .map((denom) => {
      const gasPrice = gasPrices.find((gasPrice) => gasPrice.denom === denom)?.amount;
      if (!gasPrice) {
        throw new Error(`cannot find gas price for ${denom}`);
      }

      const swapReturn = swapReturns.find((swapReturn) => swapReturn.denom === denom)?.amount;
      if (!swapReturn) {
        throw new Error(`cannot find swap return for ${denom}`);
      }

      return {
        denom,
        amount: swapReturn,
        gasPrice,
        gasUnits: Math.floor(swapReturn / gasPrice),
      };
    })
    .sort((a, b) => {
      if (a.gasUnits > b.gasUnits) return -1;
      if (a.gasUnits < b.gasUnits) return 1;
      return 0;
    });
  statusContainer.innerHTML += "done!<br />";

  // Find the gas units purchasable by uusd as a benchmark
  const uusdGasUnits = results.find((result) => result.denom === "uusd")?.gasUnits;
  if (!uusdGasUnits) {
    throw new Error("cannot find gas units for uusd");
  }

  // Generate the table
  statusContainer.innerHTML += "generating table... ";
  const tbody = results.map((result) => {
    return `
      <tr>
        <td>${result.denom}</td>
        <td>${result.gasPrice}</td>
        <td align="right">${formatInteger(result.amount)}</td>
        <td align="right">${formatInteger(result.gasUnits)}</td>
        <td align="right">${formatPercent(result.gasUnits / uusdGasUnits - 1)}</td>
      </tr>
    `;
  });
  tableContainer.innerHTML = `
    <table>
      <thead>
        <tr>
          <th scope="col">denom</th>
          <th scope="col">gas_price</th>
          <th scope="col">amount</th>
          <th scope="col">gas_units</th>
          <th scope="col">efficiency</th>
        <tr>
      </thead>
      <tbody>
        ${tbody.join("\n")}
      </tbody>
    </table>
  `;
  statusContainer.innerHTML += "done!<br />";
});
