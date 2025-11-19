const Order = require("../../model/orders.model");
const Product = require("../../model/products.model");
const systemConfig = require("../../config/system");

const currencyFormatter = new Intl.NumberFormat("vi-VN");

const ORDER_STATUS_OPTIONS = [
    { value: "pending", label: "Chưa xử lý", badge: "secondary" },
    { value: "packed", label: "Đã đóng gói", badge: "info" },
    { value: "shipping", label: "Đang giao", badge: "primary" },
    { value: "completed", label: "Hoàn thành", badge: "success" },
    { value: "failed", label: "Thất bại", badge: "danger" },
];

const ORDER_STATUS_MAP = ORDER_STATUS_OPTIONS.reduce((acc, item) => {
    acc[item.value] = item;
    return acc;
}, {});

const hasOrderPermission = (res) => {
    return (
        res.locals.roleMDW &&
        Array.isArray(res.locals.roleMDW.permissions) &&
        res.locals.roleMDW.permissions.includes("orders_view")
    );
};

const getStatusMeta = (status) => {
    return (
        ORDER_STATUS_MAP[status] ||
        ORDER_STATUS_MAP["pending"]
    );
};

const enrichOrderSummary = (order) => {
    let totalQuantity = 0;
    let totalPrice = 0;

    if (Array.isArray(order.products)) {
        for (const product of order.products) {
            const discount = Number(product.discountPercentage) || 0;
            const basePrice = Number(product.price) || 0;
            const quantity = Number(product.quantity) || 0;
            const priceAfterDiscount = Math.round(
                (basePrice * (100 - discount)) / 100
            );
            const productTotal = priceAfterDiscount * quantity;

            totalQuantity += quantity;
            totalPrice += productTotal;
        }
    }

    order.totalQuantity = totalQuantity;
    order.totalPrice = totalPrice;
    order.totalPriceDisplay = currencyFormatter.format(totalPrice);
    order.code = order._id ? order._id.toString().slice(-6).toUpperCase() : "";
    order.statusMeta = getStatusMeta(order.status);

    return order;
};

module.exports.index = async (req, res) => {
    if (!hasOrderPermission(res)) {
        req.flash("error", "Bạn không có quyền truy cập đơn hàng");
        return res.redirect(`${systemConfig.prefixAdmin}/dashboard`);
    }
    try {
        const keyword = (req.query.keyword || "").trim();
        const statusFilter = req.query.status || "";
        const findQuery = { deleted: false };

        if (keyword) {
            findQuery["userInfor.fullName"] = new RegExp(keyword, "i");
        }
        if (statusFilter) {
            if (statusFilter === "pending") {
                findQuery.$or = [
                    { status: statusFilter },
                    { status: { $exists: false } },
                    { status: null },
                    { status: "" },
                ];
            } else {
                findQuery.status = statusFilter;
            }
        }

        const orders = await Order.find(findQuery).sort({ createdAt: -1 }).lean();

        const renderOrders = orders.map((order) => enrichOrderSummary(order));

        res.render("admin/page/orders/index", {
            pageTitle: "Quản lý đơn hàng",
            orders: renderOrders,
            keyword,
            statuses: ORDER_STATUS_OPTIONS,
            statusFilter,
        });
    } catch (error) {
        console.error("Get orders admin error:", error);
        req.flash("error", "Không thể tải danh sách đơn hàng");
        res.redirect(`${systemConfig.prefixAdmin}/dashboard`);
    }
};

module.exports.detail = async (req, res) => {
    if (!hasOrderPermission(res)) {
        req.flash("error", "Bạn không có quyền truy cập đơn hàng");
        return res.redirect(`${systemConfig.prefixAdmin}/dashboard`);
    }
    try {
        const id = req.params.id;
        const order = await Order.findOne({
            _id: id,
            deleted: false,
        }).lean();

        if (!order) {
            req.flash("error", "Đơn hàng không tồn tại");
            return res.redirect(`${systemConfig.prefixAdmin}/orders`);
        }

        let totalQuantity = 0;
        let totalPrice = 0;
        const products = [];

        if (Array.isArray(order.products)) {
            for (const item of order.products) {
                const discount = Number(item.discountPercentage) || 0;
                const basePrice = Number(item.price) || 0;
                const quantity = Number(item.quantity) || 0;
                const priceAfterDiscount = Math.round(
                    (basePrice * (100 - discount)) / 100
                );
                const totalItemPrice = priceAfterDiscount * quantity;

                const productInfor = await Product.findOne({
                    _id: item.product_id,
                })
                    .select("title thumbnail")
                    .lean();

                products.push({
                    ...item,
                    productInfor,
                    finalPrice: priceAfterDiscount,
                    finalPriceDisplay: currencyFormatter.format(priceAfterDiscount),
                    totalPrice: totalItemPrice,
                    totalPriceDisplay: currencyFormatter.format(totalItemPrice),
                });

                totalQuantity += quantity;
                totalPrice += totalItemPrice;
            }
        }

        order.products = products;
        order.totalQuantity = totalQuantity;
        order.totalPrice = totalPrice;
        order.totalPriceDisplay = currencyFormatter.format(totalPrice);
        order.code = order._id ? order._id.toString().slice(-6).toUpperCase() : "";
        order.statusMeta = getStatusMeta(order.status);

        res.render("admin/page/orders/detail", {
            pageTitle: `Đơn hàng ${order.code || order._id}`,
            order,
            statuses: ORDER_STATUS_OPTIONS,
        });
    } catch (error) {
        console.error("Order detail admin error:", error);
        req.flash("error", "Không thể xem chi tiết đơn hàng");
        res.redirect(`${systemConfig.prefixAdmin}/orders`);
    }
};

module.exports.changeStatus = async (req, res) => {
    if (!hasOrderPermission(res)) {
        req.flash("error", "Bạn không có quyền thay đổi trạng thái đơn hàng");
        return res.redirect(`${systemConfig.prefixAdmin}/dashboard`);
    }
    try {
        const id = req.params.id;
        const { status } = req.body;

        if (!ORDER_STATUS_MAP[status]) {
            req.flash("error", "Trạng thái không hợp lệ");
            return res.redirect("back");
        }

        const result = await Order.updateOne(
            {
                _id: id,
                deleted: false,
            },
            {
                status,
            }
        );

        if (result.modifiedCount === 0) {
            req.flash("error", "Không thể cập nhật trạng thái đơn hàng");
        } else {
            req.flash("success", "Cập nhật trạng thái đơn hàng thành công");
        }
    } catch (error) {
        console.error("Change order status error:", error);
        req.flash("error", "Cập nhật trạng thái thất bại");
    }

    res.redirect("back");
};

