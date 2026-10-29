CREATE TABLE merchants (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE payment_methods (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  kind VARCHAR(20) NOT NULL
);

-- The code is text everywhere, so a reference that starts with 0 keeps its zeros.
CREATE TABLE payment_references (
  code VARCHAR(20) PRIMARY KEY,
  merchant_id VARCHAR(40) NOT NULL,
  type VARCHAR(10) NOT NULL,
  amount_type VARCHAR(10) NOT NULL,
  amount DECIMAL(12, 2) NULL,
  expires_on DATE NULL,
  status VARCHAR(10) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants (id)
);

-- One row per payment. Each step keeps its own date, and none is ever rewritten.
-- There is no unique key on the sequence: the repeated notice is stopped in code.
CREATE TABLE movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  folio VARCHAR(20) NULL UNIQUE,
  authorization_code VARCHAR(10) NULL,
  reference_code VARCHAR(20) NOT NULL,
  payment_method_id VARCHAR(40) NOT NULL,
  sequence VARCHAR(40) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  status VARCHAR(10) NOT NULL,
  requested_at DATETIME(3) NOT NULL,
  confirmed_at DATETIME(3) NULL,
  reversed_at DATETIME(3) NULL,
  FOREIGN KEY (reference_code) REFERENCES payment_references (code),
  FOREIGN KEY (payment_method_id) REFERENCES payment_methods (id)
);
