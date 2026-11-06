-- The log of the bridge to the wallet: one row per step, the payment resource and each webhook,
-- with the code it got. The webhook is linked by the id the wallet gave the resource, never by
-- the reference, and the folio is there when the payment was registered. The code and the amount
-- are the ones that came, also the ones it rejected, so the log never fails because of them.
CREATE TABLE bridge_operations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  operation VARCHAR(10) NOT NULL,
  reference_code VARCHAR(30) NULL,
  resource_id VARCHAR(40) NULL,
  amount DOUBLE NULL,
  qr VARCHAR(200) NULL,
  link VARCHAR(200) NULL,
  result VARCHAR(10) NOT NULL,
  folio VARCHAR(20) NULL,
  created_at DATETIME(3) NOT NULL
);
