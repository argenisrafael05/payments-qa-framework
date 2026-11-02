-- The log of the bridge to the wallet: one row per step, the payment resource and each webhook,
-- with the code it got. The webhook is linked by the id the wallet gave the resource, never by
-- the reference, and the folio is there when the payment was registered.
CREATE TABLE bridge_operations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  operation VARCHAR(10) NOT NULL,
  reference_code VARCHAR(20) NULL,
  resource_id VARCHAR(40) NULL,
  amount DECIMAL(12, 2) NULL,
  qr VARCHAR(200) NULL,
  link VARCHAR(200) NULL,
  result VARCHAR(10) NOT NULL,
  folio VARCHAR(20) NULL,
  created_at DATETIME(3) NOT NULL
);
