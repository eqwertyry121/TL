package core

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

type Role string

const (
	RoleClient  Role = "CLIENT"
	RoleKitchen Role = "KITCHEN"
	RoleCourier Role = "COURIER"
	RoleAdmin   Role = "ADMIN"
)

type Audience string

const (
	AudienceClient Audience = "client"
	AudienceStaff  Audience = "staff"
)

type FulfillmentStatus string

const (
	StatusNew            FulfillmentStatus = "NEW"
	StatusOutForDelivery FulfillmentStatus = "OUT_FOR_DELIVERY"
	StatusDelivered      FulfillmentStatus = "DELIVERED"
	StatusCancelled      FulfillmentStatus = "CANCELLED"
)

type PaymentMethod string

const (
	PaymentCash   PaymentMethod = "cash"
	PaymentCard   PaymentMethod = "card"
	PaymentCrypto PaymentMethod = "crypto"
)

type PaymentStatus string

const (
	PaymentCashPending PaymentStatus = "CASH_PENDING"
	PaymentPaid        PaymentStatus = "PAID"
	PaymentFailed      PaymentStatus = "FAILED"
	PaymentRefunded    PaymentStatus = "REFUNDED"
)

var (
	ErrForbidden             = errors.New("forbidden")
	ErrInvalidRole           = errors.New("invalid role")
	ErrInvalidInput          = errors.New("invalid input")
	ErrRestaurantClosed      = errors.New("restaurant closed")
	ErrManualDayOff          = errors.New("manual day off")
	ErrItemUnavailable       = errors.New("item unavailable")
	ErrInvalidQuantity       = errors.New("invalid quantity")
	ErrOrderStatusConflict   = errors.New("order status conflict")
	ErrIdempotencyConflict   = errors.New("idempotency conflict")
	ErrCalculationExpired    = errors.New("calculation expired")
	ErrPaymentNotConfirmed   = errors.New("payment not confirmed")
	ErrTermsRequired         = errors.New("terms acceptance required")
	ErrProductionUnsafeValue = errors.New("unsafe production config")
)

type User struct {
	ID             uuid.UUID `json:"id"`
	TelegramUserID int64     `json:"telegram_user_id"`
	Username       string    `json:"username"`
	FirstName      string    `json:"first_name"`
	LanguageCode   string    `json:"language_code"`
}

type Session struct {
	Token          string    `json:"token,omitempty"`
	TokenHash      string    `json:"-"`
	UserID         uuid.UUID `json:"user_id"`
	TelegramUserID int64     `json:"telegram_user_id"`
	Audience       Audience  `json:"audience"`
	ActiveRole     Role      `json:"active_role"`
	ExpiresAt      time.Time `json:"expires_at"`
}

type Settings struct {
	Timezone             string        `json:"timezone"`
	Currency             string        `json:"currency"`
	ManualDayOff         bool          `json:"manual_day_off"`
	DayOffBanner         string        `json:"day_off_banner"`
	FlatDeliveryFeeMinor int           `json:"flat_delivery_fee_minor"`
	SupportText          string        `json:"support_text"`
	SupportPhone         string        `json:"support_phone"`
	TermsURL             string        `json:"terms_url"`
	MaxItemQuantity      int           `json:"max_item_quantity"`
	MaxCommentLength     int           `json:"max_comment_length"`
	CashEnabled          bool          `json:"cash_enabled"`
	CardEnabled          bool          `json:"card_enabled"`
	CryptoEnabled        bool          `json:"crypto_enabled"`
	Version              int           `json:"version"`
	Schedule             []ScheduleDay `json:"schedule,omitempty"`
}

type Runtime struct {
	ServerTime           time.Time `json:"server_time"`
	Timezone             string    `json:"timezone"`
	AcceptingOrders      bool      `json:"accepting_orders"`
	Reason               string    `json:"reason"`
	NextOpening          time.Time `json:"next_opening"`
	DayOffBanner         string    `json:"day_off_banner"`
	FlatDeliveryFeeMinor int       `json:"flat_delivery_fee_minor"`
	Currency             string    `json:"currency"`
	EnabledPayments      []string  `json:"enabled_payments"`
	SupportedLocales     []string  `json:"supported_locales"`
	SupportText          string    `json:"support_text"`
}

type Category struct {
	ID        uuid.UUID  `json:"id"`
	Title     string     `json:"title"`
	SortOrder int        `json:"sort_order"`
	Items     []MenuItem `json:"items"`
}

type ScheduleDay struct {
	DayOfWeek       int    `json:"day_of_week"`
	Closed          bool   `json:"closed"`
	OpenTime        string `json:"open_time"`
	OrderCutoffTime string `json:"order_cutoff_time"`
	CloseTime       string `json:"close_time"`
	Version         int    `json:"version,omitempty"`
}

type AdminCategory struct {
	ID        uuid.UUID `json:"id"`
	TitleRU   string    `json:"title_ru"`
	TitleSR   string    `json:"title_sr"`
	TitleEN   string    `json:"title_en"`
	SortOrder int       `json:"sort_order"`
	Visible   bool      `json:"visible"`
	Archived  bool      `json:"archived"`
	ItemCount int       `json:"item_count"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AdminMenuItem struct {
	ID             uuid.UUID `json:"id"`
	CategoryID     uuid.UUID `json:"category_id"`
	TitleRU        string    `json:"title_ru"`
	TitleSR        string    `json:"title_sr"`
	TitleEN        string    `json:"title_en"`
	DescriptionRU  string    `json:"description_ru"`
	DescriptionSR  string    `json:"description_sr"`
	DescriptionEN  string    `json:"description_en"`
	PriceMinor     int       `json:"price_minor"`
	Currency       string    `json:"currency"`
	PhotoPath      string    `json:"photo_path"`
	WeightText     string    `json:"weight_text"`
	MinQuantity    int       `json:"min_quantity"`
	AllergenTextRU string    `json:"allergen_text_ru"`
	AllergenTextSR string    `json:"allergen_text_sr"`
	AllergenTextEN string    `json:"allergen_text_en"`
	SortOrder      int       `json:"sort_order"`
	Visible        bool      `json:"visible"`
	Archived       bool      `json:"archived"`
	UsedInOrders   bool      `json:"used_in_orders"`
	Version        int       `json:"version"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type MenuItem struct {
	ID           uuid.UUID `json:"id"`
	CategoryID   uuid.UUID `json:"category_id"`
	Title        string    `json:"title"`
	Description  string    `json:"description"`
	PriceMinor   int       `json:"price_minor"`
	Currency     string    `json:"currency"`
	PhotoPath    string    `json:"photo_path"`
	WeightText   string    `json:"weight_text"`
	MinQuantity  int       `json:"min_quantity"`
	AllergenText string    `json:"allergen_text"`
	SortOrder    int       `json:"sort_order"`
	Version      int       `json:"version"`
}

type CartItemInput struct {
	ItemID   uuid.UUID `json:"item_id"`
	Quantity int       `json:"quantity"`
}

type CalculatedItem struct {
	ItemID         uuid.UUID `json:"item_id"`
	Title          string    `json:"title"`
	UnitPriceMinor int       `json:"unit_price_minor"`
	Quantity       int       `json:"quantity"`
	LineTotalMinor int       `json:"line_total_minor"`
	Version        int       `json:"version"`
}

type Calculation struct {
	Token            string           `json:"calculation_token,omitempty"`
	Items            []CalculatedItem `json:"items"`
	SubtotalMinor    int              `json:"subtotal_minor"`
	DeliveryFeeMinor int              `json:"delivery_fee_minor"`
	TotalMinor       int              `json:"total_minor"`
	Currency         string           `json:"currency"`
	ExpiresAt        time.Time        `json:"expires_at"`
}

type Order struct {
	ID                uuid.UUID         `json:"id"`
	PublicNumber      int               `json:"public_number"`
	ClientUserID      uuid.UUID         `json:"client_user_id,omitempty"`
	FulfillmentStatus FulfillmentStatus `json:"fulfillment_status"`
	PaymentMethod     PaymentMethod     `json:"payment_method"`
	PaymentStatus     PaymentStatus     `json:"payment_status"`
	SubtotalMinor     int               `json:"subtotal_minor"`
	DeliveryFeeMinor  int               `json:"delivery_fee_minor"`
	TotalMinor        int               `json:"total_minor"`
	Currency          string            `json:"currency"`
	Phone             string            `json:"phone,omitempty"`
	Address           string            `json:"address,omitempty"`
	CustomerComment   string            `json:"customer_comment"`
	Locale            string            `json:"locale"`
	Version           int               `json:"version"`
	CreatedAt         time.Time         `json:"created_at"`
	ReadyAt           *time.Time        `json:"ready_at,omitempty"`
	DeliveredAt       *time.Time        `json:"delivered_at,omitempty"`
	CancelledAt       *time.Time        `json:"cancelled_at,omitempty"`
	Items             []OrderItem       `json:"items"`
	Events            []OrderEvent      `json:"events,omitempty"`
}

type OrderItem struct {
	MenuItemID     uuid.UUID `json:"menu_item_id"`
	SnapshotTitle  string    `json:"snapshot_title"`
	UnitPriceMinor int       `json:"unit_price_minor"`
	Quantity       int       `json:"quantity"`
	LineTotalMinor int       `json:"line_total_minor"`
}

type OrderEvent struct {
	ID         uuid.UUID `json:"id"`
	OrderID    uuid.UUID `json:"order_id"`
	FromStatus string    `json:"from_status"`
	ToStatus   string    `json:"to_status"`
	Action     string    `json:"action"`
	ActorRole  string    `json:"actor_role"`
	Reason     string    `json:"reason"`
	CreatedAt  time.Time `json:"created_at"`
}

type StaffMember struct {
	ID             uuid.UUID `json:"id"`
	TelegramUserID int64     `json:"telegram_user_id"`
	DisplayLabel   string    `json:"display_label"`
	Role           Role      `json:"role"`
	Active         bool      `json:"active"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type AdminDashboard struct {
	Runtime            Runtime   `json:"runtime"`
	NewOrders          int       `json:"new_orders"`
	OutForDelivery     int       `json:"out_for_delivery"`
	OrdersToday        int       `json:"orders_today"`
	RevenueTodayMinor  int       `json:"revenue_today_minor"`
	NotificationErrors []string  `json:"notification_errors"`
	GeneratedAt        time.Time `json:"generated_at"`
}

type AnalyticsSummary struct {
	AllOrders         int `json:"all_orders"`
	DeliveredOrders   int `json:"delivered_orders"`
	CancelledOrders   int `json:"cancelled_orders"`
	RevenueMinor      int `json:"revenue_minor"`
	AverageCheckMinor int `json:"average_check_minor"`
}

type AnalyticsBreakdown struct {
	Key          string `json:"key"`
	Count        int    `json:"count"`
	RevenueMinor int    `json:"revenue_minor"`
}

type TopDish struct {
	Title        string `json:"title"`
	Quantity     int    `json:"quantity"`
	RevenueMinor int    `json:"revenue_minor"`
}

type DailyAnalyticsRow struct {
	Day          string `json:"day"`
	Orders       int    `json:"orders"`
	Delivered    int    `json:"delivered"`
	Cancelled    int    `json:"cancelled"`
	RevenueMinor int    `json:"revenue_minor"`
}

type AdminAnalytics struct {
	Currency    string               `json:"currency"`
	From        time.Time            `json:"from"`
	To          time.Time            `json:"to"`
	GeneratedAt time.Time            `json:"generated_at"`
	Summary     AnalyticsSummary     `json:"summary"`
	Statuses    []AnalyticsBreakdown `json:"statuses"`
	Payments    []AnalyticsBreakdown `json:"payments"`
	TopDishes   []TopDish            `json:"top_dishes"`
	DailyRows   []DailyAnalyticsRow  `json:"daily_rows"`
}

type AuditEntry struct {
	ID         uuid.UUID      `json:"id"`
	ActorRole  string         `json:"actor_role"`
	Action     string         `json:"action"`
	TargetType string         `json:"target_type"`
	TargetID   *uuid.UUID     `json:"target_id,omitempty"`
	Reason     string         `json:"reason"`
	Before     map[string]any `json:"before,omitempty"`
	After      map[string]any `json:"after,omitempty"`
	CreatedAt  time.Time      `json:"created_at"`
}
